# BZ-Games 中继服务器部署手册

## 服务说明

BZ-Games 中继服务器是独立 Node.js 服务，提供 HTTP 房间查询和 WebSocket 透明转发能力。

- HTTP：`/health`、`/rooms`。
- WebSocket：`relay:host`、`relay:join`、`relay:leave`、`relay:heartbeat`。
- 转发内容：RoomMessage、Game API v1 JSON 消息、Game API v2 binary frame。
- 房间码：中继服务器生成、发送和识别 `roomCode`。
- 短地址：平台侧使用 `DEFAULT_RELAY_PUBLIC_HOST` 与 `roomCode` 拼接。

接口细节见 [API.md](./API.md)。

## 目录结构

```text
relay-server/
  src/index.js
  package.json
  package-lock.json
  DEPLOY.md
  API.md
```

| 路径 | 说明 |
| --- | --- |
| `src/index.js` | HTTP + WebSocket 中继服务入口 |
| `package.json` | 服务依赖与启动脚本 |
| `package-lock.json` | npm 锁定文件 |
| `DEPLOY.md` | 部署手册 |
| `API.md` | 接口文档 |

## 运行环境

- Node.js `18` 或更高版本。
- Linux 服务器。
- 公网 TCP 端口，默认 `38090`。
- npm。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `38090` | HTTP/WebSocket 监听端口 |
| `ROOM_TTL_MS` | `60000` | 房间活跃超时时间 |
| `HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket ping 与清理间隔 |
| `MAX_TEXT_BYTES` | `1048576` | 单条文本消息最大字节数 |
| `MAX_BINARY_BYTES` | `12582912` | 单条二进制消息最大字节数 |
| `RELAY_TOKEN` | 空字符串 | 房主注册和客机加入鉴权 token；空字符串表示不校验 |
| `MAX_ROOMS` | `80` | 最大同时房间数 |
| `MAX_CLIENTS` | `400` | 最大已登记客户端数 |
| `MAX_CLIENTS_PER_ROOM` | `8` | 单房间最大中继客户端数上限 |
| `MAX_EVENT_LOOP_DELAY_MS` | `250` | 事件循环延迟限制 |

公网部署必须配置 `RELAY_TOKEN`，并与平台侧 `DEFAULT_RELAY_TOKEN` 保持一致。

## 快速启动

```bash
cd relay-server
npm install --production
PORT=38090 RELAY_TOKEN=bzgames npm start
```

验证：

```bash
curl http://127.0.0.1:38090/health
curl http://127.0.0.1:38090/rooms
```

## 服务器部署

安装运行环境：

```bash
apt update
apt install -y nodejs npm git
node -v
npm -v
```

部署服务目录：

```bash
mkdir -p /opt/bz-games-relay
cd /opt/bz-games-relay
```

将 `relay-server` 目录内容同步到 `/opt/bz-games-relay` 后安装依赖：

```bash
npm install --production
```

启动验证：

```bash
PORT=38090 RELAY_TOKEN=bzgames npm start
```

## 防火墙

云服务器安全组放行 TCP `38090`。

Ubuntu 防火墙放行端口：

```bash
ufw allow 38090/tcp
```

## systemd 常驻

创建服务文件：

```bash
nano /etc/systemd/system/bz-games-relay.service
```

写入：

```ini
[Unit]
Description=BZ-Games Relay Server
After=network.target

[Service]
WorkingDirectory=/opt/bz-games-relay
ExecStart=/usr/bin/node src/index.js
Environment=PORT=38090
Environment=RELAY_TOKEN=bzgames
Environment=ROOM_TTL_MS=60000
Environment=HEARTBEAT_INTERVAL_MS=30000
Environment=MAX_TEXT_BYTES=1048576
Environment=MAX_BINARY_BYTES=12582912
Environment=MAX_ROOMS=80
Environment=MAX_CLIENTS=400
Environment=MAX_CLIENTS_PER_ROOM=8
Environment=MAX_EVENT_LOOP_DELAY_MS=250
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

启动：

```bash
systemctl daemon-reload
systemctl enable bz-games-relay
systemctl start bz-games-relay
systemctl status bz-games-relay
```

查看日志：

```bash
journalctl -u bz-games-relay -f
```

重启：

```bash
systemctl restart bz-games-relay
```

停止：

```bash
systemctl stop bz-games-relay
```

## Nginx 反向代理

直接使用 IP + 端口时无需 Nginx。使用域名入口时配置反向代理。

```nginx
server {
  listen 80;
  server_name relay.example.com;

  location / {
    proxy_pass http://127.0.0.1:38090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

平台侧 `DEFAULT_RELAY_SERVER_URL` 使用 Nginx 地址：

```typescript
export const DEFAULT_RELAY_SERVER_URL = "http://relay.example.com";
export const DEFAULT_RELAY_PUBLIC_HOST = "bzgames.top";
export const DEFAULT_RELAY_TOKEN = "bzgames";
```

## 平台配置

平台常量位置：

```text
src/shared/constants.ts
```

直连中继服务器：

```typescript
export const DEFAULT_RELAY_SERVER_URL = "http://39.106.221.85:38090";
export const DEFAULT_RELAY_PUBLIC_HOST = "bzgames.top";
export const DEFAULT_RELAY_TOKEN = "bzgames";
```

域名反向代理：

```typescript
export const DEFAULT_RELAY_SERVER_URL = "http://relay.example.com";
export const DEFAULT_RELAY_PUBLIC_HOST = "bzgames.top";
export const DEFAULT_RELAY_TOKEN = "bzgames";
```

字段规则：

- 用户看到、复制、服务器 Tab 展示、手动输入的地址为平台短地址，例如 `bzgames.top:123456`。
- 平台向中继服务器加入房间时只发送 `roomCode`，例如 `123456`。
- 中继服务器内部使用 `roomId` 管理房间。
- 中继服务器不拼接、不解析、不识别短地址。

## 容量配置

默认配置：

```ini
Environment=MAX_ROOMS=80
Environment=MAX_CLIENTS=400
Environment=MAX_CLIENTS_PER_ROOM=8
Environment=MAX_EVENT_LOOP_DELAY_MS=250
```

容量限制行为：

| 限制 | 触发结果 |
| --- | --- |
| `MAX_ROOMS` | 拒绝新房间，返回 `capacity_full/max_rooms` |
| `MAX_CLIENTS` | 拒绝新房间或新玩家，返回 `capacity_full/max_clients` |
| `MAX_CLIENTS_PER_ROOM` | 拒绝新玩家，返回 `capacity_full/room_full` |
| `MAX_EVENT_LOOP_DELAY_MS` | 拒绝新房间或新玩家，返回 `capacity_full/server_busy` |

根据 `/health` 返回的 `roomCount`、`clientCount`、`eventLoopDelayMs` 调整容量参数。

## 健康检查

本机检查：

```bash
curl http://127.0.0.1:38090/health
curl http://127.0.0.1:38090/rooms
```

公网检查：

```bash
curl http://39.106.221.85:38090/health
curl http://39.106.221.85:38090/rooms
```

返回示例：

```json
{
  "ok": true,
  "acceptingRooms": true,
  "roomCount": 0,
  "clientCount": 0,
  "eventLoopDelayMs": 0,
  "limits": {
    "maxRooms": 80,
    "maxClients": 400,
    "maxClientsPerRoom": 8,
    "maxEventLoopDelayMs": 250
  }
}
```

## 发布更新

同步新代码后执行：

```bash
cd /opt/bz-games-relay
npm install --production
node --check src/index.js
systemctl restart bz-games-relay
systemctl status bz-games-relay
```

验证：

```bash
curl http://127.0.0.1:38090/health
```

## 故障排查

### 服务未启动

```bash
systemctl status bz-games-relay
journalctl -u bz-games-relay -n 100
```

检查项：

- `WorkingDirectory` 是否为实际部署目录。
- `ExecStart` 中 node 路径是否正确。
- `npm install --production` 是否完成。
- `src/index.js` 是否存在。

### 端口无法访问

```bash
ss -lntp | grep 38090
ufw status
```

检查项：

- 进程是否监听 `38090`。
- 云服务器安全组是否放行 TCP `38090`。
- 系统防火墙是否放行 TCP `38090`。
- Nginx 代理目标是否为 `127.0.0.1:38090`。

### 客户端无法注册或加入

检查项：

- 平台侧 `DEFAULT_RELAY_SERVER_URL` 是否指向实际服务地址。
- 平台侧 `DEFAULT_RELAY_TOKEN` 是否与服务端 `RELAY_TOKEN` 一致。
- 房主是否已收到 `relay:host:ack` 和 `roomCode`。
- 客机是否从短地址解析出 `roomCode` 后发送 `relay:join`。
- `/health` 中 `acceptingRooms` 是否为 `true`。

### 房间列表为空

检查项：

- 房主是否保持 WebSocket 连接。
- 房主是否发送 `relay:host`。
- 房间是否超过 `ROOM_TTL_MS` 未更新。
- 房主是否发送 `room:disbanded` 或断开连接。

## 上线验证流程

- 启动中继服务并确认 `/health` 正常。
- 房主开启官方服务器模式并收到短地址。
- `/rooms` 返回包含 `roomCode` 的房间列表。
- 客机通过服务器 Tab 加入房间。
- 客机通过手动输入短地址加入房间。
- 客机准备/取消准备正常同步。
- 聊天消息正常收发。
- 房主开始游戏、踢出玩家、解散房间正常同步。
- Game API v1 JSON 消息和 v2 binary frame 正常通过中继转发。
