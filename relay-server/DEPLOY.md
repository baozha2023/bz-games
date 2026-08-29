# BZ-Games 中继 / 登录服务部署手册

## 服务说明

BZ-Games 官方服务是独立 Node.js 服务，提供 HTTP 房间查询、GitHub OAuth 登录、社区与分发接口和 WebSocket 透明转发能力。

- HTTP：`/health`、`/rooms`、`/auth/github/start`、`/auth/github/callback`、`/api/portal/v1/session`、`/api/auth/logout`。
- WebSocket：`relay:host`、`relay:join`、`relay:leave`、`relay:heartbeat`。
- 转发内容：RoomMessage、Game API v1 JSON 消息、Game API v2 binary frame。
- 房间码：中继服务器生成、发送和识别 `roomCode`。
- 短地址：平台侧使用 `DEFAULT_RELAY_PUBLIC_HOST` 与 `roomCode` 拼接。
- 用户基础数据：使用 MySQL 保存账号、OAuth state、登录会话、文件元数据。
- 图片对象：使用 MongoDB GridFS 保存反馈与论坛图片，避免触发 16MB BSON 限制。

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

| 路径                | 说明                      |
| ------------------- | ------------------------- |
| `src/index.js`      | HTTP + WebSocket 服务入口 |
| `package.json`      | 服务依赖与启动脚本        |
| `package-lock.json` | npm 锁定文件              |
| `DEPLOY.md`         | 部署手册                  |
| `API.md`            | 接口文档                  |

## 运行环境

- Node.js `18` 或更高版本。
- Linux 服务器。
- Relay 本机监听地址默认 `127.0.0.1:38091`，Nginx 公网入口统一使用 `38090` 端口。
- npm。
- MySQL 8+（保存用户基础数据和业务元数据）。
- MongoDB 6+（保存反馈与论坛图片）。

## 环境变量

| 变量                                 | 默认值                 | 说明                                                                        |
| ------------------------------------ | ---------------------- | --------------------------------------------------------------------------- |
| `PORT`                               | `38091`                | Relay 内部 HTTP/WebSocket 监听端口；公网由 Nginx 使用 `38090`               |
| `HOST`                               | `127.0.0.1`            | HTTP/WebSocket 监听地址；生产环境不得绑定公网网卡                           |
| `ROOM_TTL_MS`                        | `60000`                | 房间活跃超时时间                                                            |
| `HEARTBEAT_INTERVAL_MS`              | `30000`                | WebSocket ping 与清理间隔                                                   |
| `MAX_TEXT_BYTES`                     | `1048576`              | 单条文本消息最大字节数                                                      |
| `MAX_BINARY_BYTES`                   | `12582912`             | 单条二进制消息最大字节数                                                    |
| `RELAY_TOKEN`                        | 空字符串               | 全接口鉴权 token；必须通过 systemd 环境变量配置，平台侧通过构建配置注入同值 |
| `MAX_ROOMS`                          | `80`                   | 最大同时房间数                                                              |
| `MAX_CLIENTS`                        | `400`                  | 最大已登记客户端数                                                          |
| `MAX_CLIENTS_PER_ROOM`               | `10`                   | 单房间最大中继客户端数上限                                                  |
| `MAX_EVENT_LOOP_DELAY_MS`            | `250`                  | 事件循环延迟限制                                                            |
| `FEEDBACK_AUTHENTICATED_COOLDOWN_MS` | `43200000`             | 已登录用户建言献策成功后的冷却时间，默认 12 小时                            |
| `RATE_LIMIT_RESERVATION_TTL_MS`      | `300000`               | 通用限流 reservation 租约时间，默认 5 分钟                                  |
| `MYSQL_HOST`                         | `127.0.0.1`            | MySQL 主机                                                                  |
| `MYSQL_PORT`                         | `3306`                 | MySQL 端口                                                                  |
| `MYSQL_USER`                         | 空字符串               | MySQL 用户名；为空时依赖 MySQL 的接口不可用                                 |
| `MYSQL_PASSWORD`                     | 空字符串               | MySQL 密码                                                                  |
| `MYSQL_DATABASE`                     | `bz_games`             | MySQL 数据库名                                                              |
| `MONGODB_URI`                        | 空字符串               | MongoDB 连接串；为空时图片接口不可用                                        |
| `MONGODB_DB_NAME`                    | `bz_games`             | MongoDB 数据库名                                                            |
| `MONGODB_BUCKET_NAME`                | `userFiles`            | GridFS bucket 名                                                            |
| `GITHUB_CLIENT_ID`                   | 空字符串               | GitHub OAuth App Client ID                                                  |
| `GITHUB_CLIENT_SECRET`               | 空字符串               | GitHub OAuth App Client Secret                                              |
| `GITHUB_CALLBACK_URL`                | 空字符串               | GitHub OAuth 回调地址，必须与 GitHub OAuth App 配置完全一致                 |
| `GITHUB_OAUTH_SCOPE`                 | `read:user user:email` | GitHub OAuth scope                                                          |
| `SESSION_COOKIE_NAME`                | `bz_games_session`     | 登录会话 Cookie 名称                                                        |
| `OAUTH_SESSION_TTL_MS`               | `2592000000`           | 登录会话有效期，默认 30 天                                                  |
| `AUTH_EXPIRED_SESSION_RETENTION_MS`  | `604800000`            | 已过期会话保留期，默认 7 天，用于区分过期与无效令牌                         |
| `OAUTH_STATE_TTL_MS`                 | `600000`               | OAuth state 有效期，默认 10 分钟                                            |
| `ELASTICSEARCH_ENABLED`              | `false`                | ES 总开关；为 `false` 时关闭论坛搜索、ES worker 和客户端搜索框              |
| `ELASTICSEARCH_URL`                  | 空字符串               | ES 地址；仅在 `ELASTICSEARCH_ENABLED=true` 时生效                           |
| `ELASTICSEARCH_USERNAME`             | 空字符串               | 可选；Relay 访问 ES 的最小权限账号                                          |
| `ELASTICSEARCH_PASSWORD`             | 空字符串               | 可选；Relay 访问 ES 的账号密码                                              |
| `ELASTICSEARCH_INDEX_ALIAS`          | `bz_forum_posts`       | 论坛搜索 alias                                                              |
| `ELASTICSEARCH_REQUEST_TIMEOUT_MS`   | `5000`                 | ES 单次请求超时                                                             |
| `FORUM_SEARCH_WORKER_INTERVAL_MS`    | `5000`                 | outbox worker 检查间隔                                                      |

公网部署必须配置 `RELAY_TOKEN`，并与平台侧构建注入的 `relayToken` 保持一致。服务端不会兼容未携带 token 的旧版平台。
如需启用 GitHub 登录，必须额外配置 `MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_CALLBACK_URL`。

## 快速启动

```bash
cd relay-server
npm install --production
PORT=38091 \
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
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38091/health
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38091/rooms
```

本地测试 GitHub 登录地址：

```text
http://127.0.0.1:38091/auth/github/start
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
PORT=38091 \
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

云服务器安全组只放行 Nginx 的公网端口 `38090`（启用 HTTPS 时再另行规划 `443`）；不要放行 Relay 的内部端口 `38091`。

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
3. 将 callback 填成 `http://你的域名/auth/github/callback`。
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

如果你修改了 `private-build.config.json`，需要重新构建客户端，确保新的 `relayServerUrl` 被注入到主进程。

## 容量配置

默认配置：

```ini
Environment=MAX_ROOMS=80
Environment=MAX_CLIENTS=400
Environment=MAX_CLIENTS_PER_ROOM=10
Environment=MAX_EVENT_LOOP_DELAY_MS=250
```

容量限制行为：

| 限制                      | 触发结果                                             |
| ------------------------- | ---------------------------------------------------- |
| `MAX_ROOMS`               | 拒绝新房间，返回 `capacity_full/max_rooms`           |
| `MAX_CLIENTS`             | 拒绝新房间或新玩家，返回 `capacity_full/max_clients` |
| `MAX_CLIENTS_PER_ROOM`    | 拒绝新玩家，返回 `capacity_full/room_full`           |
| `MAX_EVENT_LOOP_DELAY_MS` | 拒绝新房间或新玩家，返回 `capacity_full/server_busy` |

根据 `/health` 返回的 `roomCount`、`clientCount`、`eventLoopDelayMs` 调整容量参数。

## 健康检查

本机检查：

```bash
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38091/health
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38091/rooms
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
    "maxClientsPerRoom": 10,
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
curl -H "X-Relay-Token: your-relay-token" http://127.0.0.1:38091/health
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
ss -lntp | grep -E ':38090 |:38091 '
ufw status
```

检查项：

- Nginx 是否监听公网 `38090`，Relay 是否只监听本机 `38091`。
- 云服务器安全组是否放行 Nginx 的公网端口 `38090`；当前部署不使用 `80`，未来启用 HTTPS 时另行规划 `443`。
- 系统防火墙是否放行 Nginx 的公网端口。
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
- `/auth/github/start` 与 `/auth/github/callback` 是否均经 Nginx 转发到 Relay。
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 是否填错。
- `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` 是否可连接。
- 服务器是否能访问 `github.com` 和 `api.github.com`。

### 授权后无法打开平台窗口

检查项：

- 客户端是否把 `oauthReturnUrl` 配成 `bzgames://oauth-complete`。
- Windows 是否已将 `bzgames://` 重新注册到当前安装的 BZ-Games 程序。
- 是否需要重启客户端，使 `app.setAsDefaultProtocolClient("bzgames")` 生效。
- 开发模式必须按当前 Electron 启动入口注册协议，即 `electron.exe <path.resolve(process.argv[1])> "%1"`；不要把协议指向 `out/main/index.js`。
- 授权返回地址是否被浏览器当作普通网页链接处理。

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

## 论坛、建言献策和管理后台

反馈与管理配置已完整列入 `relay-server/bz-games-relay.service.example`，无需在其他文档
维护第二份字段清单。部署时将对应值写入同一个
`/etc/systemd/system/bz-games-relay.service` 的 `[Service]` 段。

MySQL已配置时，服务启动会执行统一 Schema 初始化并自动创建反馈表。
反馈历史游标分页要求 `feedback` 表具有复合索引
`idx_feedback_user_history (user_id, created_at, id)`。新环境由统一 Schema 初始化直接创建；
已有生产表应在代码发布前备份数据库、用 `SHOW INDEX FROM feedback` 检查，并在索引缺失时执行一次
`ALTER TABLE feedback ADD INDEX idx_feedback_user_history (user_id, created_at, id)`。
发布后再次用 `SHOW INDEX` 验证三列顺序，确认健康检查和反馈历史接口正常后，才可删除本次数据库备份。
管理前端生产构建产物部署到 Nginx 静态目录 `/var/www/campusmate/admin`，随后访问 `/admin/`；Relay 的 `ADMIN_STATIC_DIR` 仍用于本机直连或开发回退，不是当前公网 Nginx 的静态根目录。替换静态目录前创建独立备份，完成页面、响应头、权限和服务健康检查后再删除本次备份与临时文件。
建言献策仅允许已登录用户提交，并按 GitHub ID 冷却 12 小时。限流状态持久化在
MySQL 的 `rate_limit_records` 表中，服务重启或多实例部署不会清空；对应配置以
`bz-games-relay.service.example` 为准。该表会在服务启动时由统一 Schema 初始化自动创建。

论坛图片复用 MongoDB GridFS；论坛文字和计数使用 MySQL。论坛搜索可选用本仓库提供的
单节点 Elasticsearch 部署文件：

```bash
cd /opt/bz-games-relay/deploy/elasticsearch
cp .env.example .env
editor .env
docker compose build
docker compose up -d
curl --max-time 30 -u elastic:YOUR_ELASTICSEARCH_PASSWORD http://127.0.0.1:9200/_cluster/health
```

这是一次可回滚的试探部署，不应阻塞 Relay 上线：先观察健康检查是否在 30 秒内返回。如果
服务器内存不足、容器启动卡住或健康检查失败，立即执行 `docker compose down`，然后将
systemd 中的 `ELASTICSEARCH_ENABLED=false` 并清空 `ELASTICSEARCH_URL` 后重启 Relay。此时普通论坛信息流、发帖、评论和
点赞继续可用，客户端通过 `GET /api/v1/forum/search-status` 隐藏搜索框；后台 ES outbox
同步失败不打印错误、不影响主请求，仅保留数据库中的重试状态。只有健康检查稳定通过后，
才在 systemd 中设置 `ELASTICSEARCH_ENABLED=true`，填写 `ELASTICSEARCH_URL`、账号和密码并重启 Relay。

该 Compose 固定 Elasticsearch `8.19.0`，Docker 数据卷持久化，HTTP 只绑定
`127.0.0.1:9200`，并在镜像构建时安装同为 `8.19.0` 的 analysis-ik。Relay 的
`ELASTICSEARCH_USERNAME` 应配置为仅能访问论坛索引的独立账号；生产环境应在 ES 中
创建该账号并授予最小索引权限，不要让 Relay 使用 `elastic` 超级账号。Kibana 不属于
本部署，也不对公网开放。

启动 Relay 时配置 `ELASTICSEARCH_ENABLED=true`、`ELASTICSEARCH_URL`、账号和密码。首次启动会创建
`bz_forum_posts_v1` 及 `bz_forum_posts` 别名；帖子创建和软删除通过
`forum_search_outbox` 异步同步。ES 暂时不可用时，最新帖子流、发帖和评论仍可用，
带搜索词的请求返回可重试错误；不会回退到 MySQL `LIKE`。需要重建索引时应先创建
新的版本化索引，再原子切换别名。

手动全量重建当前索引可执行：

```bash
cd /opt/bz-games-relay
ELASTICSEARCH_ENABLED=true \
ELASTICSEARCH_URL=http://127.0.0.1:9200 \
ELASTICSEARCH_USERNAME=relay_forum \
ELASTICSEARCH_PASSWORD=YOUR_ELASTICSEARCH_PASSWORD \
MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=bz_games \
MYSQL_PASSWORD=your-mysql-password MYSQL_DATABASE=bz_games \
npm run rebuild:forum-search
```

示例中的值均不是生产配置。真实域名、数据库连接串、OAuth Secret和
中继令牌只能写入服务器的 `/etc/systemd/system/bz-games-relay.service`，不得提交到仓库。

# 最新桌面版下载部署

生产 systemd 必须配置：

```ini
Environment=DESKTOP_RELEASE_STORAGE_DIR=/var/lib/bz-games-releases
Environment=MAX_DESKTOP_RELEASE_FILE_BYTES=536870912
Environment=DESKTOP_RELEASE_BANDWIDTH_BPS=100000000
```

创建发布账号和目录，账号不授予 sudo：

```bash
useradd --create-home --shell /bin/bash bz-release-deploy
install -d -o bz-release-deploy -g bz-release-deploy -m 2750 /var/lib/bz-games-releases
install -d -o bz-release-deploy -g bz-release-deploy -m 2750 /var/lib/bz-games-releases/.incoming
```

发布目录必须保留 setgid，确保 Relay 服务以 root 执行管理端手动上传时，新文件仍继承
`bz-release-deploy` 组。共享发布程序会在原子切换前把安装包和 `latest.json` 的属主、属组统一为发布目录属主、属组，并显式设置为 `0640`；GitHub Actions 与管理端不得各自维护文件权限逻辑。
`bz-release-deploy` 还必须能够遍历 `/opt/bz-games-relay` 并读取
`scripts/publish-desktop-release.js`，但不得拥有服务端代码目录的写权限。

GitHub Environment、SSH 专用密钥和主机指纹配置见
[`docs/GITHUB_ACTIONS_RELEASE_DEPLOY.md`](../docs/GITHUB_ACTIONS_RELEASE_DEPLOY.md)。发布工作流先以非阻塞方式获取
`flock /var/lib/bz-games-releases/.publish.lock`，持锁完成流式上传并调用 `scripts/publish-desktop-release.js`。发布程序校验稳定
semver、规范文件名、大小、PE 文件头和 SHA-256，原子切换 `latest.json` 后删除旧安装器和备份。

管理端超级管理员可通过“平台版本”页面上传 EXE，允许将正式版切换到高于或低于当前版本的稳定版本；普通管理员只能查看当前版本。该入口调用 `/api/admin/v1/desktop-release`，使用相同发布目录、
`flock` 和发布程序，不维护第二套版本切换逻辑。上传最大请求体由 Node 接口按
`MAX_DESKTOP_RELEASE_FILE_BYTES + 1 MiB` 流式限制；若管理端经 Nginx 代理，精确路由还必须把 `client_max_body_size`
设置为不小于 513 MiB。管理端同样在读取请求体前非阻塞取锁；已有上传时立即返回
`409 desktop_release_upload_busy`，不会等待或暂存第二个文件。

生产环境只保留 Nginx 这一套公网入口。Nginx 监听公网 `38090`，直接托管 `/admin/` 静态页面，并将当前 `/api/...`、`/auth/...`、房间 HTTP 接口和 `/ws/` WebSocket 请求转发到本机 Relay `127.0.0.1:38091`；不再保留旧服务前缀或 Relay `38091` 的公网兼容转发。外部客户端统一使用 `http://39.106.221.85:38090`（正式环境应替换为域名），官网和客户端发行版下载统一使用 `/api/v1/releases/latest/download`。GitHub Actions 发布仍通过 SSH 将安装包交给服务器上的发布脚本，不新增 HTTP 上传兼容入口。

现有 IP 站点使用以下统一路由：

```nginx
location /admin/ {
    root /var/www/campusmate;
    try_files $uri $uri/ /admin/index.html;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
}

location = /api/v1/releases/latest/download {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location = /api/admin/v1/desktop-release {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 513m;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location ^~ /api/portal/v1/game-hosting/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 220m;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location ^~ /api/v1/game-hosting/assets/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location ^~ /api/admin/v1/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 24m;
    proxy_request_buffering off;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
}

location ^~ /api/portal/v1/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 24m;
    proxy_request_buffering off;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
}

location ^~ /api/v1/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 24m;
    proxy_request_buffering off;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
}

location ^~ /auth/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
    proxy_read_timeout 180s;
}

location /ws/ {
        proxy_pass http://127.0.0.1:38091;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

特殊接口的边界保持明确：

- GitHub Actions：SSH 到服务器后写入发布暂存目录，再调用 `publish-desktop-release.js`，不经过 Nginx。
- 超级管理员上传桌面版本：`POST /api/admin/v1/desktop-release`，经 Nginx 精确转发，最大请求体 513 MiB。
- 客户端下载托管游戏：`GET|HEAD /api/v1/game-hosting/assets/...`，经 Nginx 转发并保留长超时与 Range。
- 创作者上传托管游戏：`/api/portal/v1/game-hosting/...`，经 Nginx 转发，最大请求体 220 MiB。

修改后先执行 `nginx -t`，通过后再 reload。Nginx 不配置 `limit_rate`；所有下载共享的 100 Mbps 总上限由单实例
Relay 内的 `GlobalBandwidthLimiter` 统一执行。若未来运行多个 Relay 实例，必须把限流迁移到共享网关，不能把每个
实例都配置成 100 Mbps。

公网验证：

```bash
curl -I http://39.106.221.85:38090/api/v1/releases/latest/download
curl -H 'Range: bytes=0-1023' -o /dev/null -D - http://39.106.221.85:38090/api/v1/releases/latest/download
```

旧配置中的以下内容必须删除，而不是继续保留作兜底：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8000;
}

location /ws/ {
    proxy_pass http://127.0.0.1:8000;
}
```

# 游戏托管部署补充

生产 systemd 单元必须配置：

```ini
Environment=GAME_HOSTING_STORAGE_DIR=/var/lib/bz-games-hosting
Environment=MAX_GAME_HOSTING_FILE_BYTES=209715200
Environment=MAX_GAME_HOSTING_IMAGE_BYTES=5242880
Environment=MAX_GAME_HOSTING_TOTAL_BYTES=5368709120
```

首次部署创建独立目录并限制权限：

```bash
install -d -m 0750 /var/lib/bz-games-hosting/files
install -d -m 0700 /var/lib/bz-games-hosting/tmp
```

服务启动时初始化 `hosted_games`、`hosted_game_metadata_revisions`、`hosted_game_versions`、`hosted_game_assets` 四张表。托管 JSON 只接受市场 Schema 2，`gameManifest` override 只接受完整 Manifest V2；ZIP 内 `game.json` 不解压、不改写。历史托管 JSON 由维护窗口中的一次性 `scripts/convert-hosted-metadata-v2.mjs --service-env --apply` 转换，转换成功并验证后应从服务器删除该脚本和临时备份；服务启动路径不包含任何 V1 兼容或 `ALTER TABLE` 逻辑。`users.nickname` 是独立于 GitHub `name` 的客户端昵称字段，`users.is_online` 与 `users.last_online_at` 用于客户端主动在线状态；`users.role` 固定为 `player/creator/administrator/super_administrator`，服务端将角色映射为管理端 capability：管理员不能修改角色或上传桌面客户端版本，超级管理员拥有全部 capability。桌面客户端 Bearer 接口只校验是否登录，不读取角色。所有 OAuth 新用户为玩家，登录永不改变已有角色；GitHub ID `208792845` 由初始化定义幂等设为初始超级管理员。仓库只维护 `mysql-service.js` 中的最新初始化定义，不保存 ALTER 脚本。

逻辑前缀 `games.bzgames.top/` 不需要 DNS 或 Nginx 配置。ZIP 与市场图片均由客户端解析到 `relayServerUrl`，并要求 `RELAY_TOKEN`。
