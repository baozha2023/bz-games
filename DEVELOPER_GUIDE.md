# BZ-Games 开发者指南

本文档旨在指导开发者如何开发适配 BZ-Games 平台的游戏。BZ-Games 是一个无服务器的本地游戏平台，提供统一的联机房间管理和消息中继服务。

## 一、 游戏接入规范

### 1.1 游戏包结构

一个标准的 BZ-Games 游戏包（文件夹或 ZIP 压缩包）应包含以下核心文件：

```
my-game/
├── game.json          # 必须：游戏清单文件（平台识别入口）
├── game.exe           # 必须：游戏可执行文件（或脚本，如 game.js）
├── icon.png           # 可选：游戏图标
├── cover.jpg          # 可选：游戏封面（推荐尺寸 460x215）
└── ...其他资源文件
```

### 1.2 清单文件 (game.json)

`game.json` 是游戏的身份标识，必须位于游戏根目录下。

```json
{
  "id": "com.developer.mygame",
  "name": "我的超级游戏",
  "version": "1.0.0",
  "description": "一款精彩的联机对战游戏",
  "author": "开发者名称",
  "platformVersion": ">=1.0.0",
  "entry": "./game.exe",
  "icon": "./icon.png",
  "cover": "./cover.jpg",
  "type": "multiplayer",
  "multiplayer": {
    "minPlayers": 2,
    "maxPlayers": 4
  },
  "args": ["--fullscreen"],
  "env": {
    "MY_CUSTOM_VAR": "value"
  }
}
```

**关键字段说明：**
*   **id**: 全局唯一标识符，建议使用反向域名格式（如 `com.studio.game`）。
*   **entry**: 游戏的启动入口文件路径（相对于 `game.json`）。支持 `.exe`, `.bat`, `.js` (需环境), `.py` (需环境) 等。
*   **type**: `"singleplayer"` (单机) 或 `"multiplayer"` (联机)。
*   **multiplayer**: 联机游戏必须配置，指定最小和最大玩家人数。

---

## 二、 游戏启动与环境

当用户在平台点击“启动”或“开始游戏”时，平台会启动 `game.json` 中 `entry` 指定的进程，并注入环境变量。

**重要提示：** 对于通过系统浏览器启动的 HTML5 游戏，平台会在游戏根目录下生成 `bz-config.js` 文件，游戏应优先从该文件读取配置。

### 2.1 基础环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `BZ_PLATFORM` | 标识当前运行在 BZ-Games 平台 | `"1"` |
| `BZ_PLATFORM_VERSION` | 平台版本号 | `"1.0.0"` |
| `BZ_GAME_ID` | 当前游戏的 ID | `"com.developer.mygame"` |
| `BZ_PLAYER_ID` | 当前玩家的持久化 ID | `"uuid-string"` |
| `BZ_PLAYER_NAME` | 当前玩家的昵称 | `"Player1"` |

### 2.2 联机 API 连接配置

游戏需连接本地 WebSocket 服务以进行联机。配置获取优先级：
1. `window.BZ_CONFIG` (若存在 `bz-config.js`)
2. 环境变量 (Native 游戏)
3. URL Query 参数 (Web 游戏备选)

| 配置项 | 说明 | 用途 |
|--------|------|------|
| `apiPort` / `BZ_API_PORT` | 本地 Game API Server 端口 | 用于 WebSocket 连接 |
| `token` / `BZ_API_TOKEN` | 鉴权 Token | 用于连接后的身份认证 |

### 2.3 联机房间变量 (仅联机模式)

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `BZ_ROOM_ID` | 当前房间 ID | `"room-uuid"` |
| `BZ_IS_HOST` | 当前玩家是否为房主 | `"1"` (是) 或 `"0"` (否) |

---

## 三、 Game API Server 接口文档

游戏进程需通过 WebSocket 连接到 `ws://127.0.0.1:{apiPort}`。

**连接建立后，必须在 30 秒内发送 `auth` 请求，否则连接将被断开。**

### 3.1 通信协议

所有消息均为 JSON 格式：

**请求 (Request):**
```json
{
  "id": "req-uuid",        // 请求唯一ID
  "type": "request",
  "action": "action.name", // 调用的 API 方法名
  "payload": { ... }       // 参数
}
```

**响应 (Response):**
```json
{
  "id": "req-uuid",        // 对应请求的 ID
  "type": "response",
  "action": "action.name",
  "payload": { ... },      // 返回结果
  "error": "..."           // 仅在失败时存在
}
```

**事件 (Event):** (由平台主动推送给游戏)
```json
{
  "id": "evt-uuid",
  "type": "event",
  "action": "event.name",
  "payload": { ... }
}
```

### 3.2 核心流程

1.  **连接**: 游戏启动后，读取 `BZ_API_PORT`，建立 WebSocket 连接。
2.  **认证 (Auth)**: 连接建立后，**必须立即**发送 `auth` 请求，携带 `BZ_API_TOKEN`。
3.  **就绪**: 认证成功后，进行游戏初始化，完成后发送 `game.ready`。
4.  **通信**: 使用 `message.send` 或 `message.broadcast` 进行游戏内数据交换。
5.  **结束**: 游戏结束时发送 `game.end`。

### 3.3 API 方法详情

#### 1. `auth` - 身份认证
**必须在连接后首先调用，否则连接会被断开。**

*   **Payload**: `{ "token": "从环境变量 BZ_API_TOKEN 获取" }`
*   **Response**: `{ "success": true, "player": { "id": "...", "name": "...", "isHost": boolean } }`

#### 2. `game.ready` - 游戏就绪
通知平台游戏窗口已加载完毕，准备好接收事件。

*   **Payload**: `{}`
*   **Response**: `{ "acknowledged": true }`

#### 3. `room.getInfo` - 获取房间信息
获取当前房间内的所有玩家列表及状态。

*   **Payload**: `{}`
*   **Response**:
    ```json
    {
      "id": "room-id",
      "hostId": "host-player-id",
      "players": [
        { "id": "p1", "name": "Name1", "isHost": true },
        { "id": "p2", "name": "Name2", "isHost": false }
      ],
      "state": "playing"
    }
    ```

#### 4. `message.broadcast` - 广播消息
向房间内**除自己以外**的所有玩家发送消息。这是联机游戏最常用的通信方式。

*   **Payload**: `{ "data": ANY_JSON_OBJECT }`
*   **Response**: `{ "success": true }`
*   **接收端行为**: 其他玩家将收到 `event.message` 事件。

#### 5. `message.send` - 单播消息
向指定玩家发送消息。

*   **Payload**: `{ "to": "target-player-id", "data": ANY_JSON_OBJECT }`
*   **Response**: `{ "success": true }`

#### 6. `game.end` - 结束游戏
通知平台游戏已结束（例如分出胜负）。

*   **Payload**: `{ "reason": "win/lose/draw" }`
*   **Response**: `{ "success": true }`

---

### 3.4 事件通知 (Platform -> Game)

#### 1. `event.message` - 收到消息
当其他玩家调用 `message.broadcast` 或 `message.send` 时触发。

*   **Payload**:
    ```json
    {
      "from": "sender-player-id",
      "data": { ... } // 对方发送的数据
    }
    ```

#### 2. `event.playerJoined` - 玩家加入
当有新玩家加入房间时触发（支持中途加入的游戏需处理）。

*   **Payload**: `{ "player": { "id": "...", "name": "..." } }`

#### 3. `event.playerLeft` - 玩家离开
当有玩家断开连接或离开房间时触发。

*   **Payload**: `{ "playerId": "..." }`

---

## 四、 代码示例 (Node.js)

以下是一个最小化的 Node.js 游戏接入示例：

```javascript
const WebSocket = require('ws');

// 1. 获取环境变量
const PORT = process.env.BZ_API_PORT;
const TOKEN = process.env.BZ_API_TOKEN;

if (!PORT || !TOKEN) {
  console.error('请在 BZ-Games 平台中启动本游戏');
  process.exit(1);
}

// 2. 连接平台
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

ws.on('open', () => {
  console.log('Connected to BZ-Games Platform');
  // 3. 认证
  sendRequest('auth', { token: TOKEN });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'response') {
    handleResponse(msg);
  } else if (msg.type === 'event') {
    handleEvent(msg);
  }
});

function sendRequest(action, payload) {
  const req = {
    id: Date.now().toString(), // 简易 ID 生成
    type: 'request',
    action,
    payload
  };
  ws.send(JSON.stringify(req));
}

function handleResponse(res) {
  if (res.action === 'auth' && res.payload.success) {
    console.log('认证成功！玩家:', res.payload.player.name);
    // 认证成功后，标记就绪
    sendRequest('game.ready', {});
  }
}

function handleEvent(evt) {
  if (evt.action === 'event.message') {
    console.log(`收到来自 ${evt.payload.from} 的消息:`, evt.payload.data);
  }
}
```
