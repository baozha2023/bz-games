# BZ-Games 开发者指南

本文档是 BZ-Games 平台的官方开发指南，旨在帮助开发者开发适配本平台的游戏，或将现有游戏移植到 BZ-Games 平台。

---

## 一、 平台概述

BZ-Games 是一个**无服务器的本地联机游戏平台**。它采用“房主即主机”的架构，平台负责提供统一的房间管理、内网穿透对接（用户自备工具）和消息中继服务。

对于游戏开发者而言，**不需要编写任何网络服务端代码**。游戏只需连接本地运行的 **Game API Server** (WebSocket)
，即可实现联机通讯、成就解锁等功能。

### 核心架构

* **平台 (Launcher)**: 负责启动游戏进程，并运行一个本地 WebSocket 服务器 (Game API Server)。
* **游戏 (Game)**: 作为 WebSocket 客户端连接平台，通过 JSON 消息调用平台能力。
* **联机**: 平台之间通过 P2P 或中继方式同步状态，游戏进程只需关心与本地平台的通信。

---

## 二、 游戏包结构规范

一个标准的 BZ-Games 游戏包是一个包含 `game.json` 的目录。平台导入仅支持目录（不支持 ZIP 导入），结构如下：

```text
my-game/
├── game.json          # [必须] 游戏清单文件，定义元数据和配置
├── index.html         # [Web游戏] 游戏入口文件
├── game.exe           # [Native游戏] 游戏可执行文件
├── icon.png           # [推荐] 游戏图标 (建议 256x256)
├── cover.png          # [推荐] 游戏封面 (建议 16:9，如 1920x1080)
├── preview.mp4        # [可选] 游戏详情页预览视频
└── assets/            # 其他资源文件
```

### 2.1 游戏清单 (game.json)

`game.json` 必须位于游戏根目录下，是平台识别游戏的唯一凭证。

```json
{
  "id": "com.developer.mygame",
  "name": "我的游戏名称",
  "version": "1.0.0",
  "description": "游戏简要介绍...",
  "author": "开发者名称",
  "platformVersion": ">=1.0.0",
  "entry": "index.html",
  "icon": "icon.png",
  "cover": "cover.png",
  "video": "preview.mp4",
  "type": "singlemultiple",
  "multiplayer": {
    "minPlayers": 2,
    "maxPlayers": 4
  },
  "achievements": [
    {
      "id": "first_win",
      "title": "初次胜利",
      "description": "赢得一场比赛"
    }
  ],
  "statistics": [
    {
      "total_score": "总分数"
    },
    {
      "gamesPlayed": {
        "label": "游戏局数",
        "mode": "increment"
      }
    }
  ],
  "args": [
    "--fullscreen"
  ],
  "env": {
    "MY_VAR": "custom_value"
  }
}
```

**字段详解：**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | string | 是 | 全局唯一标识，建议使用反向域名格式 (如 `com.studio.game`) |
| `name` | string | 是 | 游戏显示名称 |
| `version` | string | 是 | 游戏版本号 (SemVer 格式，如 `1.0.0`) |
| `description` | string | 否 | 游戏描述 |
| `author` | string | 否 | 作者名称 |
| `platformVersion`| string/array | 是 | 兼容的平台版本范围 (如 `">=1.0.0"` 或 `["1.0.0", "2.0.0"]`) |
| `entry` | string | 是 | 启动入口文件路径 (相对于根目录) |
| `type` | string | 是 | `"singleplayer"` (单机) / `"multiplayer"` (联机) / `"singlemultiple"` (单人+联机) |
| `multiplayer` | object | 联机必填 | 包含 `minPlayers` 和 `maxPlayers` (整数)，`type` 为 `multiplayer` 或 `singlemultiple` 时必填 |
| `icon` | string | 否 | 图标路径 |
| `cover` | string | 否 | 封面路径 |
| `video` | string | 否 | 详情页预览视频路径，支持 `mp4/webm/ogv/mov/m4v`，自动播放一次后回到封面 |
| `encryptLocalStorage` | boolean | 否 | 是否启用 `gamedata.json` 加密持久化，仅对 Web 游戏 `localStorage` 生效，默认 `false` |
| `achievements` | array | 否 | 成就列表定义 |
| `statistics` | array | 否 | 统计指标列表，支持字符串或键值对格式，如 `["time", {"score": "得分"}, {"gamesPlayed": { "label": "局数", "mode": "increment" }}]`。`mode` 为 `increment` 或 `full`，默认为 `increment`。`time` (游玩时长) 由平台自动统计，无需在此定义。 |
| `args` | array | 否 | 启动参数列表 (仅 Native 游戏有效) |
| `env` | object | 否 | 注入的环境变量 (仅 Native 游戏有效) |

---

## 三、 游戏启动与环境配置

当游戏启动时，平台会提供必要的连接信息（端口、Token、玩家信息）。

### 3.1 Web 游戏 (HTML5)

对于 `entry` 为 `.html` 和 `serve` 的游戏，平台会在游戏根目录生成临时配置文件。推荐使用 `bz-config.js`，并在 HTML 中引入：

```html

<script src="bz-config.js"></script>
```

`bz-config.js` 会向全局作用域注入 `window.BZ_CONFIG` 对象：

```javascript
window.BZ_CONFIG = {
    apiPort: 12345,           // 本地 WebSocket 端口
    token: "auth-token-...",  // 认证 Token
    playerId: "uuid-...",     // 当前玩家 ID
    playerName: "PlayerName", // 当前玩家昵称
    playerAvatar: "data:image/png;base64,...", // 玩家头像 (Base64)
    roomId: "room-uuid",      // 当前房间 ID，单机为空字符串
    isHost: true,             // 当前玩家是否为房主
    isMultiple: true          // 当前是否为联机模式
};
```

如果你自行管理配置文件，也可使用 `bz-config`（无扩展名）或 `bz-config.json`。建议游戏按以下顺序读取：

1. `window.BZ_CONFIG`
2. `bz-config.js` / `bz-config` / `bz-config.json`
3. URL 参数

**备选方案**：如果上述配置都不存在（例如调试模式），游戏应尝试从 URL 参数获取配置：
`index.html?apiPort=12345&token=...&playerId=...&playerAvatar=...&roomId=...&isHost=1&isMultiple=1`
**注意**：entry 为 `serve` 模式时，游戏平台会使用 npm 的 `serve` 命令启动游戏并托管静态资源。

### 3.2 Native 游戏 (Exe/Executable)

对于可执行文件，平台通过 **环境变量** 传递配置：

| 环境变量名 |  说明 || :--- | :-     -- |
| `BZ_API _PORT` | 本地 WebS     ocket 端口 |
|  `BZ_API_TOKEN` | 认   证 Token |
|  `BZ_PLAYER_ID` | 当前玩 家 ID |
| `BZ_PLAYER_N AME` | 当前玩家昵称        |
| `BZ_PLAYER_AVATAR ` | 当前玩家头像 (Ba       se64) |
| `BZ_ROOM_ID` | 当前房间 ID (仅联机模式) |
| `BZ_IS_HOST` | 是否为房主 (`"1"` 或 `"0"`) |

### 3.3 数据持久化注意事项 (Web 游戏)

Web 游戏通常使用 `localStorage` 或 `IndexedDB` 存储本地数据（如存档、设置）。

* **平台接管机制**：平台通过预加载脚本 (`preload/game.js`) 自动接管并覆盖了游戏的 `localStorage` 接口。
* **统一存储路径**：所有 `localStorage` 数据会被重定向存储到 `games/<id>/<version>/gamedata.json` 文件中。
* **版本隔离**：不同版本的游戏拥有独立的 `gamedata.json`，确保存档互不干扰。
* **可选加密**：当 Manifest 配置 `"encryptLocalStorage": true` 时，平台会对 `gamedata.json` 进行加密存储；不配置时默认明文。
* **启动模式互通**：无论使用 `index.html` 还是 `serve` 模式启动，只要是同一游戏同一版本，都将读取同一个 `gamedata.json`
  ，彻底解决了浏览器同源策略导致的存档隔离问题。
    * **开发者提示**：你无需修改游戏代码，只需像往常一样使用 `localStorage.getItem()` 和 `setItem()` 即可。

---

## 四、 Game API 通信协议

游戏与平台通过 WebSocket 进行通信。

* **地址**: `ws://127.0.0.1:{apiPort}`
* **格式**: JSON
* **超时**: 连接建立后，必须在 **30秒** 内发送 `auth` 请求，否则会被断开。

### 4.1 消息结构

**请求 (Request) - 游戏发给平台:**

```json
{
  "id": "uuid-req-1",
  // 请求唯一ID
  "type": "request",
  "action": "action.name",
  // API 方法名
  "payload": {
    ...
  }
  // 参数
}
```

**响应 (Response) - 平台回复游戏:**

```json
{
  "id": "uuid-req-1",
  // 对应请求的ID
  "type": "response",
  "action": "action.name",
  "payload": {
    ...
  },
  // 返回数据
  "error": "Error msg"
  // 仅失败时存在
}
```

**事件 (Event) - 平台推送给游戏:**

```json
{
  "id": "uuid-evt-1",
  "type": "event",
  "action": "event.name",
  "payload": {
    ...
  }
}
```

---

## 五、 API 接口详解

### 5.1 基础流程

#### `auth` (认证)

**[必须]** 连接 WebSocket 后必须立即调用的第一个接口。

* **Request Payload**:
  ```json
  { "token": "从配置或环境变量获取的 Token" }
  ```
* **Response Payload**:
  ```json
  {
    "success": true,
    "player": {
      "id": "p-123",
      "name": "PlayerName",
      "isHost": true  // 当前玩家是否为房主
    }
  }
  ```

#### `game.ready` (就绪)

通知平台游戏加载完毕，可以接收其他玩家的消息。

* **Request Payload**: `{}`
* **Response Payload**: `{ "acknowledged": true }`

#### `game.end` (结束)

通知平台本局游戏结束。

* **Request Payload**: `{ "reason": "win" }` (reason 可选)
* **Response Payload**: `{ "success": true }`

### 5.2 房间与联机

#### `room.getInfo` (获取房间信息)

获取当前房间状态和玩家列表。

* **Request Payload**: `{}`
* **Response Payload**:
  ```json
  {
    "id": "room-uuid",
    "hostId": "p-123",
    "players": [
      { "id": "p-123", "name": "HostPlayer", "isHost": true },
      { "id": "p-456", "name": "ClientPlayer", "isHost": false }
    ],
    "state": "playing"
  }
  ```

#### `message.broadcast` (广播消息)

向房间内**除自己以外**的所有玩家发送消息。支持发送文本或语音（音频数据）。

* **Request Payload**:
  ```json
  {
    "data": { "type": "move", "x": 1, "y": 2 }, // 任意 JSON 对象
    "contentType": "text" // 可选: 'text' | 'audio' (默认 'text')
  }
  ```
* **Response Payload**: `{ "success": true }`
* **行为说明**：
    - 平台不会把这条广播回传给发送者自己（避免本地重复处理）。
    - 平台会自动补齐 `senderId`、`messageId`、`sentAt` 字段到中继消息中。

#### `message.send` (单播消息)

向指定玩家发送消息。支持发送文本或语音。

* **Request Payload**:
  ```json
  {
    "to": "target-player-id",
    "data": { "content": "Hello secret" },
    "contentType": "text" // 可选: 'text' | 'audio' (默认 'text')
  }
  ```
* **Response Payload**: `{ "success": true }`
* **参数要求**：
    - 必须提供 `to` 或 `targetPlayerId` 其中之一。
    - 不允许把目标设置为自己。

### 5.3 成就系统

#### `achievement.unlock` (解锁成就)

触发成就解锁。平台会自动处理重复解锁请求（如果已解锁则忽略）。

* **Request Payload**:
  ```json
  {
    "achievementId": "first_win", // 对应 game.json 中的 id
    "playerId": "p-123"           // 当前玩家 ID
  }
  ```
* **Response Payload**:
  ```json
  {
    "success": true,
    "new": true // 如果是首次解锁则为 true
  }
  ```

### 5.4 统计系统

#### `stats.report` (上报统计数据)

上报游戏内的统计数据（如得分、击杀数等）。需在 `game.json` 的 `statistics` 字段中预先定义。
注意：`time` (游戏时长) 由平台自动统计，无需上报。

`statistics` 字段支持以下写法：

```json
[
  "kills",
  {
    "score": "得分"
  },
  {
    "endless_high_score": {
      "label": "无尽最高分",
      "mode": "full"
    }
  }
]
```

`mode` 说明：

- `increment`：增量统计（默认）
- `full`：全量统计（以传入值覆盖）

* **Request Payload**:
  ```json
  {
    "kills": 5,
    "score": 100,
    "endless_high_score": 12000
  }
  ```
* **Response Payload**:
  ```json
  {
    "success": true
  }
  ```

---

## 六、 事件通知 (Platform -> Game)

游戏需监听 WebSocket 的 `message` 事件来处理以下通知：

#### `event.message` (收到消息)

当其他玩家调用 `broadcast` 或 `send` 时触发。

* **Payload**:
  ```json
  {
    "senderId": "sender-player-id",
    "messageId": "uuid-message-id",
    "sentAt": 1713333333333,
    "data": { ... } // 对方发送的数据
  }
  ```
* **幂等建议**：
    - 建议游戏侧用 `messageId` 做去重，防止网络重试或重连场景下重复处理同一消息。

#### `event.playerJoined` (玩家加入)

有新玩家加入房间时触发。

* **Payload**:
  ```json
  {
    "player": { "id": "...", "name": "..." }
  }
  ```

#### `event.playerLeft` (玩家离开)

有玩家断开连接时触发。

* **Payload**: `{ "playerId": "..." }`

#### `event.gameEnd` (强制结束)

当房主解散房间或平台强制结束游戏时触发。

* **Payload**: `{ "reason": "..." }`

---

## 七、 开发代码示例 (JavaScript)

以下是一个通用的 Web 游戏接入模板：

```javascript
// 1. 获取配置
function getConfig() {
    if (window.BZ_CONFIG) return window.BZ_CONFIG;

    // URL 参数回退
    const params = new URLSearchParams(window.location.search);
    return {
        apiPort: params.get('apiPort'),
        token: params.get('token'),
        playerId: params.get('playerId'),
        playerName: 'Unknown',
        isMultiple: params.get('isMultiple') === '1'
    };
}

const config = getConfig();
let ws = null;

// 2. 初始化连接
function initConnection() {
    if (!config.apiPort) return console.error("未找到 BZ-Games 配置");

    ws = new WebSocket(`ws://127.0.0.1:${config.apiPort}`);

    ws.onopen = () => {
        console.log("已连接平台");
        // 3. 发送认证
        sendRequest('auth', {token: config.token});
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'response') handleResponse(msg);
        if (msg.type === 'event') handleEvent(msg);
    };
}

// 4. 发送请求封装
function sendRequest(action, payload) {
    const id = crypto.randomUUID(); // 或使用简易 UUID 生成器
    ws.send(JSON.stringify({id, type: 'request', action, payload}));
}

// 5. 处理响应
function handleResponse(res) {
    if (res.action === 'auth' && res.payload.success) {
        console.log("认证成功！我是:", res.payload.player.name);
        // 认证成功后，获取房间信息并准备就绪
        sendRequest('room.getInfo', {});
        sendRequest('game.ready', {});
    }
}

// 6. 处理事件
function handleEvent(evt) {
    if (evt.action === 'event.message') {
        console.log(`收到 ${evt.payload.from} 的消息:`, evt.payload.data);
        // 处理游戏逻辑...
    }
}

// 启动
initConnection();
```
