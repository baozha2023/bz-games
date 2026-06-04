# BZ-Games 中继服务器部署手册

## 目录说明

- `src/index.js`：HTTP + WebSocket 透明中继服务，仅解析 `relay:*` 控制信令用于登记房间和建立路由；其它 RoomMessage / Game API v1 JSON / Game API v2 binary frame 均原样转发。
- `package.json`：独立 Node.js 服务依赖，仅依赖 `ws`。

## 最低环境

- Node.js 18 或更高版本
- 一台有公网 IP 的 Linux 服务器
- 开放 TCP 端口，默认 `38090`

## 部署步骤

```bash
cd relay-server
npm install --production
PORT=38090 npm start
```

## 阿里云 Ubuntu 24.04 快速部署

```bash
apt update
apt install -y nodejs npm git
node -v
npm -v

cd /opt/relay-server
npm install --production
PORT=38090 npm start
```

阿里云安全组需要放行 TCP `38090`。如果启用 Ubuntu 防火墙，也需要放行：

```bash
ufw allow 38090/tcp
```

## 使用 systemd 常驻

创建 `/etc/systemd/system/bz-games-relay.service`：

```ini
[Unit]
Description=BZ-Games Relay Server
After=network.target

[Service]
WorkingDirectory=/opt/relay-server
ExecStart=/usr/bin/node src/index.js
Environment=PORT=38090
Environment=RELAY_TOKEN=bzgames
Environment=ROOM_TTL_MS=60000
Environment=MAX_TEXT_BYTES=1048576
Environment=MAX_BINARY_BYTES=12582912
Environment=PUBLIC_ROOM_HOST=bzgames.top
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

启动服务：

```bash
systemctl daemon-reload
systemctl enable bz-games-relay
systemctl start bz-games-relay
systemctl status bz-games-relay
```

## Nginx 反向代理可选配置

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
  }
}
```

## 接入客户端

当前客户端已预留 `DEFAULT_RELAY_SERVER_URL` 和 `DEFAULT_RELAY_TOKEN` 常量，位置：

```text
src/shared/constants.ts
```

拿到服务器地址后，将其改为：

```typescript
export const DEFAULT_RELAY_SERVER_URL = "http://39.106.221.85:38090";
export const DEFAULT_RELAY_TOKEN = "bzgames";
```

如果后续配置了 HTTPS 域名，则改为：

```typescript
export const DEFAULT_RELAY_SERVER_URL = "https://relay.example.com";
export const DEFAULT_RELAY_TOKEN = "bzgames";
```

## 容量保护

中继服务器会在以下情况下拒绝新房间或新玩家接入，返回 `relay:error`：

- `MAX_ROOMS`：最大同时房间数，默认 `80`。
- `MAX_CLIENTS`：最大 WebSocket 连接数，默认 `400`。
- `MAX_CLIENTS_PER_ROOM`：单房间最大 relay 连接数，默认 `8`。
- `MAX_EVENT_LOOP_DELAY_MS`：事件循环延迟阈值，默认 `250ms`，超过表示服务器繁忙。

当前阿里云规格为 `2 vCPU / 2 GiB / 40 GiB`，建议初始保守配置：

```ini
Environment=MAX_ROOMS=80
Environment=MAX_CLIENTS=400
Environment=MAX_CLIENTS_PER_ROOM=8
Environment=MAX_EVENT_LOOP_DELAY_MS=250
```

后续可根据 `/health` 返回的 `roomCount`、`clientCount`、`eventLoopDelayMs` 和实际带宽占用调整。

## 官方房间短地址

房主通过 `relay:host` 注册房间成功后，服务端返回：

```json
{
  "type": "relay:host:ack",
  "payload": {
    "roomId": "uuid",
    "roomCode": "123456",
    "publicAddress": "bzgames.top:123456"
  }
}
```

客机输入 `bzgames.top:123456` 后，客户端应识别 `bzgames.top:` 前缀，并向官方中继服务器发送 `relay:join`，payload 中携带 `address` 或 `roomCode`。

## 中继职责边界

中继服务器不是 RoomServer，也不理解游戏业务逻辑。它只做三件事：

- 通过 `relay:host` 登记房间，用于 `/rooms` 展示，并生成 `bzgames.top:随机数字` 短地址。
- 通过 `relay:join` 将玩家连接登记到某个房间，支持 `roomId` / `relayRoomId` / `roomCode` / `bzgames.top:随机数字`。
- 根据 `payload.to` / `payload.targetPlayerId` 或房间广播规则，原样转发 text/binary WebSocket 数据。

若配置了 `RELAY_TOKEN`，客户端注册房间和加入房间时必须在 `relay:host` / `relay:join` 的 payload 中携带相同 `token`。建议公网部署时必须配置。

以下逻辑仍应由客户端平台内的 RoomServer / RoomClient / GameApiServer 负责：

- 房间加入校验、准备状态、踢人、解散、游戏开始。
- Game API v1/v2 协议语义。
- v2 binary frame 的业务解析。

## 当前状态

- 已实现服务器房间列表查询协议 `/rooms`。
- 已实现 relay 控制信令：`relay:host`、`relay:join`、`relay:leave`、`relay:heartbeat`。
- 已支持 v1 Game API 对应的 JSON 房间中继消息原样转发：`game:message:relay`、`game:broadcast:relay`、`game:message:ack`。
- 已支持 v2 Game API 的 WebSocket binary frame 原样透传：4 字节 header 长度 + JSON header + binary body。
- 客户端当前已能查询服务器房间列表；完整 relay 联机接入需要在客户端继续补齐房主上报和 relay WebSocket 连接逻辑。

## 健康检查

```bash
curl http://127.0.0.1:38090/health
curl http://127.0.0.1:38090/rooms
```

预期返回 JSON。
