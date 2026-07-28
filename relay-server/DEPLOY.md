# BZ-Games 中继 / 登录 / 云同步服务部署手册

## 服务说明

BZ-Games 官方服务是独立 Node.js 服务，提供 HTTP 房间查询、GitHub OAuth 登录、用户云数据存储和 WebSocket 透明转发能力。

- HTTP：`/health`、`/rooms`、`/auth/github/start`、`/auth/github/callback`、`/api/auth/me`、`/api/auth/logout`、`/api/cloud/files`。
- WebSocket：`relay:host`、`relay:join`、`relay:leave`、`relay:heartbeat`。
- 转发内容：RoomMessage、Game API v1 JSON 消息、Game API v2 binary frame。
- 房间码：中继服务器生成、发送和识别 `roomCode`。
- 短地址：平台侧使用 `DEFAULT_RELAY_PUBLIC_HOST` 与 `roomCode` 拼接。
- 云数据：保存 `config.json` 与 `play_sessions.db` 对应的 SQL 逻辑备份，供平台上传、下载、覆盖同步。
- 用户基础数据：使用 MySQL 保存账号、OAuth state、登录会话、文件元数据。
- 云端对象内容：使用 MongoDB GridFS 保存，避免配置文件或 SQL dump 增长后触发 16MB BSON 限制。

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
| `src/index.js` | HTTP + WebSocket 服务入口 |
| `package.json` | 服务依赖与启动脚本 |
| `package-lock.json` | npm 锁定文件 |
| `DEPLOY.md` | 部署手册 |
| `API.md` | 接口文档 |

## 运行环境

- Node.js `18` 或更高版本。
- Linux 服务器。
- 公网 TCP 端口，默认 `38090`。
- npm。
- MySQL 8+（保存用户基础数据和文件元数据）。
- MongoDB 6+（保存 `config.json` 文件内容和 `play_sessions.db` 对应 SQL dump）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `38090` | HTTP/WebSocket 监听端口 |
| `ROOM_TTL_MS` | `60000` | 房间活跃超时时间 |
| `HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket ping 与清理间隔 |
| `MAX_TEXT_BYTES` | `1048576` | 单条文本消息最大字节数 |
| `MAX_BINARY_BYTES` | `12582912` | 单条二进制消息最大字节数 |
| `MAX_CLOUD_FILE_BYTES` | `67108864` | 单次上传云文件大小上限 |
| `RELAY_TOKEN` | 空字符串 | 全接口鉴权 token；必须通过 systemd 环境变量配置，平台侧通过构建配置注入同值 |
| `MAX_ROOMS` | `80` | 最大同时房间数 |
| `MAX_CLIENTS` | `400` | 最大已登记客户端数 |
| `MAX_CLIENTS_PER_ROOM` | `8` | 单房间最大中继客户端数上限 |
| `MAX_EVENT_LOOP_DELAY_MS` | `250` | 事件循环延迟限制 |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 主机 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | 空字符串 | MySQL 用户名；为空时登录和云同步接口不可用 |
| `MYSQL_PASSWORD` | 空字符串 | MySQL 密码 |
| `MYSQL_DATABASE` | `bz_games` | MySQL 数据库名 |
| `MONGODB_URI` | 空字符串 | MongoDB 连接串；为空时登录和云同步接口不可用 |
| `MONGODB_DB_NAME` | `bz_games` | MongoDB 数据库名 |
| `MONGODB_BUCKET_NAME` | `userFiles` | GridFS bucket 名 |
| `GITHUB_CLIENT_ID` | 空字符串 | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | 空字符串 | GitHub OAuth App Client Secret |
| `GITHUB_CALLBACK_URL` | 空字符串 | GitHub OAuth 回调地址，必须与 GitHub OAuth App 配置完全一致 |
| `GITHUB_OAUTH_SCOPE` | `read:user user:email` | GitHub OAuth scope |
| `SESSION_COOKIE_NAME` | `bz_games_session` | 登录会话 Cookie 名称 |
| `OAUTH_SESSION_TTL_MS` | `2592000000` | 登录会话有效期，默认 30 天 |
| `OAUTH_STATE_TTL_MS` | `600000` | OAuth state 有效期，默认 10 分钟 |

公网部署必须配置 `RELAY_TOKEN`，并与平台侧构建注入的 `relayToken` 保持一致。服务端不会兼容未携带 token 的旧版平台。
如需启用 GitHub 登录，必须额外配置 `MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_CALLBACK_URL`。
如需启用云文件同步，还必须额外配置 `MONGODB_URI`。

## 快速启动

```bash
cd relay-server
npm install --production
PORT=38090 \
RELAY_TOKEN=your-relay-token \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=bz_games \
MYSQL_PASSWORD=your-mysql-password \
MYSQL_DATABASE=bz_games \
MONGODB_URI=mongodb://bz_games:your-mongodb-password@127.0.0.1:27017/bz_games \
GITHUB_CLIENT_ID=your-client-id \
GITHUB_CLIENT_SECRET=your-client-secret \
GITHUB_CALLBACK_URL=http://relay.example.com:38090/auth/github/callback \
npm start
```

验证：

```bash
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38090/health
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38090/rooms
```

本地测试 GitHub 登录地址：

```text
http://127.0.0.1:38090/auth/github/start
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

MySQL 推荐保存账号、会话和元数据；MongoDB 推荐只负责文件内容。

### 安装 MySQL

```bash
apt update
apt install -y mysql-server
systemctl enable mysql
systemctl start mysql
systemctl status mysql
```

创建数据库和账号：

```bash
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS bz_games
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'bz_games'@'127.0.0.1' IDENTIFIED BY 'your-mysql-password';
GRANT ALL PRIVILEGES ON bz_games.* TO 'bz_games'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

验证：

```bash
mysql -h127.0.0.1 -ubz_games -p bz_games -e "SELECT 1;"
```

### 安装 MongoDB

导入官方仓库并安装（Ubuntu）：

```bash
apt update
apt install -y curl gnupg
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME)/mongodb-org/8.0 multiverse" \
  | tee /etc/apt/sources.list.d/mongodb-org-8.0.list
apt update
apt install -y mongodb-org
systemctl enable mongod
systemctl start mongod
systemctl status mongod
```

创建数据库账号：

```bash
mongosh <<'MONGO'
use bz_games
db.createUser({
  user: "bz_games",
  pwd: "your-mongodb-password",
  roles: [
    { role: "readWrite", db: "bz_games" }
  ]
})
MONGO
```

验证：

```bash
mongosh "mongodb://bz_games:your-mongodb-password@127.0.0.1:27017/bz_games" --eval "db.runCommand({ ping: 1 })"
```

### 环境变量配置建议

- `MYSQL_HOST=127.0.0.1`
- `MYSQL_PORT=3306`
- `MYSQL_USER=bz_games`
- `MYSQL_PASSWORD=your-mysql-password`
- `MYSQL_DATABASE=bz_games`
- `MONGODB_URI=mongodb://bz_games:your-mongodb-password@127.0.0.1:27017/bz_games`
- `MONGODB_DB_NAME=bz_games`
- `MONGODB_BUCKET_NAME=userFiles`
- `GITHUB_CALLBACK_URL=http://relay.example.com:38090/auth/github/callback`

启动验证：

```bash
PORT=38090 \
RELAY_TOKEN=your-relay-token \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=bz_games \
MYSQL_PASSWORD=your-mysql-password \
MYSQL_DATABASE=bz_games \
MONGODB_URI=mongodb://bz_games:your-mongodb-password@127.0.0.1:27017/bz_games \
GITHUB_CLIENT_ID=your-client-id \
GITHUB_CLIENT_SECRET=your-client-secret \
GITHUB_CALLBACK_URL=http://relay.example.com:38090/auth/github/callback \
npm start
```

## 防火墙

云服务器安全组放行 TCP `38090`。

Ubuntu 防火墙放行端口：

```bash
ufw allow 38090/tcp
```

## systemd 常驻

仓库中的 `bz-games-relay.service.example` 是服务端配置字段的唯一完整示例。
先复制示例，再仅在服务器上填写真实值：

```bash
install -m 0600 relay-server/bz-games-relay.service.example \
  /etc/systemd/system/bz-games-relay.service
editor /etc/systemd/system/bz-games-relay.service
```

替换其中所有 `YOUR_...` 和示例域名。新增或删除服务端配置字段后，运行
`npm run check:config`；该检查会确保 `src/config.js` 与 systemd 示例字段完全一致。
服务文件包含生产密钥，必须保持 `root:root` 所有权和 `0600` 权限。

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

## 平台配置

平台侧私有构建配置位置：

```text
private-build.config.json
```

直连中继服务器：

```json
{
  "relayServerUrl": "http://relay.example.com:38090",
  "relayPublicHost": "relay.example.com",
  "relayToken": "your-relay-token",
  "oauthReturnUrl": "bzgames://oauth-complete"
}
```

> `Client ID` 和 `Client Secret` **不要写进** `private-build.config.json`。
> 这两个值必须只写在服务器环境变量中：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`。
> `private-build.config.json` 属于客户端构建配置，写入 Secret 会导致泄露风险。
> `oauthReturnUrl` 是桌面端自定义协议回调地址，不是 GitHub OAuth App 的 `Authorization callback URL`。

字段规则：

- 用户看到、复制、服务器 Tab 展示、手动输入的地址为平台短地址，例如 `relay.example.com:123456`。
- 平台向中继服务器加入房间时只发送 `roomCode`，例如 `123456`。
- 中继服务器内部使用 `roomId` 管理房间。
- 中继服务器不拼接、不解析、不识别短地址。

## GitHub OAuth App 注册

在 GitHub OAuth App 页面中，`Authorization callback URL` 填：

`http://relay.example.com:38090/auth/github/callback`

必须与服务端环境变量 `GITHUB_CALLBACK_URL` 完全一致，协议、域名、端口、路径都要一致。

推荐流程：

1. 先确定你的最终公网域名。
2. 在 GitHub 创建 OAuth App。
3. 将 callback 填成 `http://你的域名:38090/auth/github/callback`。
4. 把 GitHub 给你的 `Client ID` 写到服务端 `GITHUB_CLIENT_ID`。
5. 把 GitHub 给你的 `Client Secret` 写到服务端 `GITHUB_CLIENT_SECRET`。
6. 重启 `bz-games-relay` 服务。

验证登录入口：

```text
http://relay.example.com:38090/auth/github/start
```

未来 Electron 客户端接入时，可通过：

```text
http://relay.example.com:38090/auth/github/start?returnTo=bzgames://oauth-complete
```

让服务端在 GitHub 登录成功后跳回桌面端自定义协议。

如果你修改了 `private-build.config.json`，需要重新构建客户端，确保新的 `oauthReturnUrl` 被注入到主进程。

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
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38090/health
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38090/rooms
```

公网检查：

```bash
curl -H "X-Relay-Token: your-relay-token" http://relay.example.com:38090/health
curl -H "X-Relay-Token: your-relay-token" http://relay.example.com:38090/rooms
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
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38090/health
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
- `MONGODB_URI`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_CALLBACK_URL` 是否已正确配置。
- `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 是否已正确配置。

### 端口无法访问

```bash
ss -lntp | grep 38090
ufw status
```

检查项：

- 进程是否监听 `38090`。
- 云服务器安全组是否放行 TCP `38090`。
- 系统防火墙是否放行 TCP `38090`。
- 公网 IP / 域名是否正确指向当前服务器。

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

### GitHub 登录失败

检查项：

- GitHub OAuth App 的 callback 地址是否与 `GITHUB_CALLBACK_URL` 完全一致。
- 域名与端口是否能直接访问 `38090`。
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 是否填错。
- `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` 是否可连接。
- 服务器是否能访问 `github.com` 和 `api.github.com`。

### 授权后无法打开平台窗口

检查项：

- 客户端是否把 `oauthReturnUrl` 配成 `bzgames://oauth-complete`。
- Windows 是否已将 `bzgames://` 重新注册到当前安装的 BZ-Games 程序。
- 是否需要重启客户端，使 `app.setAsDefaultProtocolClient("bzgames")` 生效。
- 授权返回地址是否被浏览器当作普通网页链接处理。

### 云数据上传 / 下载失败

检查项：

- `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` 是否可用。
- `MONGODB_URI` 是否可用。
- `MAX_CLOUD_FILE_BYTES` 是否过小。
- 上传时是否携带登录会话 Cookie 或 Bearer Token。
- 客户端下载 `play_sessions.db` 对应 SQL dump 后是否可以正常清空并重建本地 SQLite 表数据。

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
## 建言献策和管理后台

反馈与管理配置已完整列入 `relay-server/bz-games-relay.service.example`，无需在其他文档
维护第二份字段清单。部署时将对应值写入同一个
`/etc/systemd/system/bz-games-relay.service` 的 `[Service]` 段。

MySQL已配置时，服务启动会执行统一 Schema 初始化并自动创建反馈表。
管理前端生产构建产物放入 `ADMIN_STATIC_DIR`，随后访问 `/admin/`。
匿名反馈按 Socket IP冷却 48 小时，登录反馈按 GitHub ID冷却 6 小时。两类冷却都只存在于当前 Node进程，重启后清空；对应配置以 `bz-games-relay.service.example` 为准。

示例中的值均不是生产配置。真实管理员 ID、域名、数据库连接串、OAuth Secret和
中继令牌只能写入服务器的 `/etc/systemd/system/bz-games-relay.service`，不得提交到仓库。
