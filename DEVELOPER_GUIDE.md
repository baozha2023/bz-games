# BZ-Games 开发者指南

本文档是 BZ-Games 平台的官方开发指南，旨在帮助开发者开发适配本平台的游戏，或将现有游戏移植到 BZ-Games 平台。

---

## 一、 平台概述

BZ-Games 是一个**无服务器的本地联机游戏平台**。它采用"房主即主机"的架构，平台负责提供统一的房间管理、内网穿透对接（用户自备工具）和消息中继服务。

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
  "author_url": "https://github.com/developer",
  "platformVersion": ">=1.0.0",
  "entry": "index.html",
  "web_url": "https://example.com",
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
| `version` | string | 是 | 游戏版本号 (SemVer 格式，如 `1.0.0`)。`networkgame` 类型游戏版本号不参与校验与去重，仅以 `id` 判断唯一性。 |
| `description` | string | 否 | 游戏描述 |
| `author` | string | 否 | 作者名称 |
| `author_url` | string | 否 | 作者主页链接，游戏详情页与市场页将在作者名称旁显示跳转图标 |
| `platformVersion`| string/array | 是 | 兼容的平台版本范围 (如 `">=1.0.0"` 或 `["1.0.0", "2.0.0"]`) |
| `entry` | string | 是 | 启动入口。支持本地入口文件（如 `index.html`、`game.exe`）、`serve` 或 `url` |
| `web_url` | string | `entry=url` 时必填 | 远程网页地址（必须为合法 `https?://` URL） |
| `type` | string | 是 | `"singleplayer"` (单机) / `"multiplayer"` (联机) / `"singlemultiple"` (单人+联机) / `"networkgame"` (网页游戏，仅网页直连启动，**忽略版本号，仅以 ID 去重**) |
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
    apiPort: "12345",         // 本地 WebSocket 端口 (string)
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

**备选方案**：如果上述配置都不存在，游戏应尝试从 URL 参数获取配置：
`index.html?apiPort=12345&token=...&playerId=...&playerAvatar=...&roomId=...&isHost=1&isMultiple=1`
**注意**：
- `entry=serve` 时，游戏平台会使用静态托管方式启动并访问本地 `index.html`。
- `entry=url` 时，游戏平台会直接打开 `web_url` 指向的网站，不会生成/注入 `bz-config.js`，也不会注入 `window.BZ_CONFIG`。

### 3.2 Native 游戏 (Exe/Executable)

对于可执行文件，平台通过 **环境变量** 传递配置：

| 环境变量名 | 说明 |
| :--- | :--- |
| `BZ_API_PORT` | 本地 WebSocket 端口 |
| `BZ_API_TOKEN` | 认证 Token |
| `BZ_PLAYER_ID` | 当前玩家 ID |
| `BZ_PLAYER_NAME` | 当前玩家昵称 |
| `BZ_PLAYER_AVATAR` | 当前玩家头像 (Base64) |
| `BZ_ROOM_ID` | 当前房间 ID (仅联机模式) |
| `BZ_IS_HOST` | 是否为房主 (`"1"` 或 `"0"`) |

### 3.3 数据持久化注意事项 (Web 游戏)

Web 游戏通常使用 `localStorage` 或 `IndexedDB` 存储本地数据（如存档、设置）。

* **平台接管机制**：平台通过预加载脚本 (`preload/game.js`) 自动接管并覆盖了游戏的 `localStorage` 接口。
* **统一存储路径**：所有 `localStorage` 数据会被重定向存储到 `games/<id>/<version>/gamedata.json` 文件中。
* **版本隔离**：非 `networkgame` 类型游戏的不同版本拥有独立的 `gamedata.json`，确保存档互不干扰。`networkgame` 类型游戏版本不参与隔离，同一 `id` 始终共享同一份数据。
* **可选加密**：当 Manifest 配置 `"encryptLocalStorage": true` 时，平台会对 `gamedata.json` 进行加密存储；不配置时默认明文。
* **启动模式互通**：无论使用 `index.html` 还是 `serve` 模式启动，只要是同一游戏同一版本（`networkgame` 类型为同一 `id`），都将读取同一个 `gamedata.json`
  ，彻底解决了浏览器同源策略导致的存档隔离问题。
    * **开发者提示**：你无需修改游戏代码，只需像往常一样使用 `localStorage.getItem()` 和 `setItem()` 即可。

---

## 四、 Game API 通信协议

游戏进程与平台通过 **本地 WebSocket** 通信。平台在启动游戏前启动一个本地 WebSocket 服务器（Game API Server），游戏作为客户端连接后，通过 JSON 消息调用平台能力。

### 4.1 连接地址

```
ws://127.0.0.1:{apiPort}
```

`apiPort` 通过以下方式获取：

| 平台 | 获取方式 |
| :--- | :--- |
| Web 游戏 | `window.BZ_CONFIG.apiPort` |
| Native 游戏 | 环境变量 `BZ_API_PORT` |

### 4.2 认证超时

连接建立后，必须在 **60 秒** 内发送 `auth` 请求完成认证，否则平台会主动断开连接。

### 4.3 协议版本

| 版本 | 激活方式 | 可用接口 | 帧类型 |
| :--- | :--- | :--- | :--- |
| **v1**（默认） | 不传 `protocolVersion` 或传非 `2` 的值 | `message.send`、`message.broadcast` | 仅 JSON text frame |
| **v2** | `auth` 时传入 `"protocolVersion": 2` | `message.send`、`message.broadcast`、`message.publish`、`message.batch`、`message.subscribe`、`message.unsubscribe` | JSON text frame + WebSocket binary frame |

> 连接认证后协议版本**固定不可切换**。

---

### 4.4 消息格式

所有消息均为 JSON。一条消息包含以下字段：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 消息唯一标识，建议使用 UUID |
| `type` | `"request"` \| `"response"` \| `"event"` | 消息类型 |
| `action` | `string` | 接口名称（如 `"auth"`、`"message.send"`） |
| `payload` | `object` | 消息内容，具体结构由各接口定义 |

#### 请求（Game → Platform）

游戏向平台发出的消息，`type` 固定为 `"request"`。

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "request",
  "action": "auth",
  "payload": { "token": "..." }
}
```

#### 响应（Platform → Game）

平台对请求的回复，`type` 固定为 `"response"`，`id` 与对应请求一致。

**成功时**不含 `error` 字段：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "response",
  "action": "auth",
  "payload": { "success": true, "player": { ... } }
}
```

**失败时**含 `error` 字段：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "response",
  "action": "message.send",
  "error": {
    "code": "TARGET_NOT_FOUND",
    "message": "Target player is not in room",
    "detail": { "targetPlayerId": "p-404" }
  }
}
```

`error` 值可以是字符串（v1）或结构化对象（v2）。v2 的结构化错误见 [5.5.5](#555-结构化错误)。

#### 事件（Platform → Game）

平台主动推送的消息，`type` 固定为 `"event"`，游戏收到后不需要回复。

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "type": "event",
  "action": "event.message",
  "payload": {
    "senderId": "p-456",
    "messageId": "...",
    "data": { "type": "move", "x": 10 }
  }
}
```

---

### 4.5 v2 二进制帧

v2 协议支持通过 WebSocket binary frame 发送原始二进制数据，避免 `ArrayBuffer` 转为 Base64 造成 33% 体积膨胀。

> **限制**：二进制帧仅用于 `message.send`、`message.broadcast`、`message.publish`。认证、成就、统计等控制接口仍使用 JSON text frame。

#### 帧结构

```
┌──────────────────┬──────────────────────┬─────────────────┐
│  headerLength    │  JSON header         │  binary body    │
│  (4 bytes BE)    │  (UTF-8)             │  (raw bytes)    │
└──────────────────┴──────────────────────┴─────────────────┘
```

| 区段 | 长度 | 编码 | 说明 |
| :--- | :--- | :--- | :--- |
| `headerLength` | 4 字节 | `UInt32BE` | JSON header 的字节长度，不含自身 |
| `header` | 变长 | UTF-8 | 普通 JSON 请求头，`payload.data` 不携带二进制主体 |
| `body` | 变长 | 原始字节 | 二进制负载 |

**Header 示例**：

```json
{
  "id": "uuid-req-1",
  "type": "request",
  "action": "message.publish",
  "payload": {
    "channel": "state",
    "seq": 1024,
    "delivery": "latest",
    "contentType": "binary"
  }
}
```

#### 发送（游戏 → 平台）

```javascript
function encodeBinaryFrame(header, body) {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const buf = new ArrayBuffer(4 + headerBytes.byteLength + body.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, headerBytes.byteLength, false);          // big-endian
  new Uint8Array(buf, 4, headerBytes.byteLength).set(headerBytes);
  new Uint8Array(buf, 4 + headerBytes.byteLength).set(new Uint8Array(body));
  return buf;
}

const positionData = new Float32Array([10.0, 20.0, 0.5]).buffer;
ws.send(encodeBinaryFrame({
  id: crypto.randomUUID(),
  type: "request",
  action: "message.publish",
  payload: { channel: "state", seq: 1024, delivery: "latest", contentType: "binary" }
}, positionData));
```

#### 接收（平台 → 游戏）

```javascript
ws.binaryType = "arraybuffer";
ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    const view = new DataView(event.data);
    const headerLength = view.getUint32(0, false);
    const headerBytes = new Uint8Array(event.data, 4, headerLength);
    const header = JSON.parse(new TextDecoder().decode(headerBytes));
    const body = event.data.slice(4 + headerLength);
    // header.payload 含 contentType: "binary", binary: true, byteLength
    // body 为原始二进制数据
    return;
  }
  const msg = JSON.parse(event.data);
  // JSON 消息处理
};
```

**单帧上限**：`auth.capabilities.maxBinaryBytes`（1 MB）。超限帧会被拒绝。

---

## 五、 API 接口详解

所有接口遵循以下公共规则：

- **请求**：`type = "request"`，`action` 为接口名
- **响应**：`type = "response"`，`id` 与请求一致，`action` 与请求一致
- **错误码**：v2 返回结构化错误对象，v1 返回字符串。详见 [5.5.5](#555-结构化错误)

---

### 5.1 认证与身份

#### `auth` — 认证

> **必须最先调用。** 连接 WebSocket 后第一个接口，不认证无法调用其他任何接口。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `token` | `string` | 是 | 平台生成的认证 Token |
| `protocolVersion` | `2` | 否 | 显式声明使用 v2 协议。不传或非 `2` 时使用 v1 |

```json
{ "token": "<BZ_CONFIG.token 或 BZ_API_TOKEN>", "protocolVersion": 2 }
```

**Response（v1）**

```json
{
  "success": true,
  "player": {
    "id": "p-123",
    "name": "PlayerName",
    "isHost": true
  }
}
```

**Response（v2，含 `capabilities`）**

```json
{
  "success": true,
  "protocolVersion": 2,
  "player": {
    "id": "p-123",
    "name": "PlayerName",
    "isHost": true
  },
  "capabilities": {
    "protocolVersion": 2,
    "protocolName": "bz-game-api-v2",
    "maxMessageBytes": 131072,
    "maxBinaryBytes": 1048576,
    "maxBatchMessages": 64,
    "supportsPublish": true,
    "supportsBatch": true,
    "supportsAck": true,
    "supportsSubscribe": true,
    "supportsDelivery": true,
    "supportsBinaryContentType": true,
    "supportsBinaryFrames": true
  }
}
```

**`capabilities` 字段**：描述当前连接的能力上限，见 [5.5.1](#551-capabilities-能力声明)。

| 响应字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `success` | `boolean` | 认证是否成功 |
| `protocolVersion` | `1` \| `2` | 当前连接的协议版本 |
| `player.id` | `string` | 当前玩家 ID |
| `player.name` | `string` | 当前玩家昵称 |
| `player.isHost` | `boolean` | 是否为房主（联机模式有效） |
| `capabilities` | `object` | v2 能力声明（仅 v2 返回） |

**错误**：Token 不匹配时平台直接关闭连接，不返回错误消息。

---

#### `player.getInfo` — 获取本地玩家信息

在 `auth` 之后即可调用，返回当前玩家的基本信息。

**Request**

```json
{}
```

**Response**

```json
{
  "id": "p-123",
  "name": "PlayerName"
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 当前玩家 ID |
| `name` | `string` | 当前玩家昵称 |

---

### 5.2 游戏生命周期

#### `game.ready` — 通知就绪

通知平台游戏已加载完毕，可以接收其他玩家的消息。调用后才开始接收 `event.message` 事件。

**Request**

```json
{}
```

**Response**

```json
{ "acknowledged": true }
```

---

#### `game.report` — 提交战绩报告

游戏完成一局后，向平台提交战绩报告。报告以**富媒体卡片**形式显示在房间聊天中，所有房间玩家可见。

支持三种模式，总大小不超过 **128 KB**。

> **注意**：调用此接口不会结束游戏进程、不会改变房间状态。游戏进程结束由平台自动检测。

**模式一：文本**

```json
{
  "text": "红队 3:1 蓝队，玩家A 夺得 MVP"
}
```

聊天框显示为普通系统消息。

**模式二：结构化 — 计分板**

```json
{
  "mode": "structured",
  "title": "击杀竞赛",
  "style": "border-color: #4caf50;",
  "data": {
    "layout": "scoreboard",
    "rows": [
      { "playerId": "p-1", "kills": 12, "deaths": 3, "score": 1500, "won": true },
      { "playerId": "p-2", "kills":  8, "deaths": 5, "score":  900 },
      { "playerId": "p-3", "kills":  4, "deaths": 7, "score":  450 }
    ],
    "stats": [
      { "label": "击杀", "values": { "p-1": 12, "p-2": 8, "p-3": 4 } },
      { "label": "死亡", "values": { "p-1":  3, "p-2": 5, "p-3": 7 } }
    ],
    "duration": 1205
  },
  "config": {
    "columns": [
      { "key": "playerId", "label": "玩家", "render": "playerName", "width": "2fr" },
      { "key": "kills",    "label": "击杀", "align": "center" },
      { "key": "score",    "label": "分数", "render": "score", "align": "right" }
    ],
    "highlightTop": 3,
    "compact": false
  }
}
```

**scoreboard 顶层字段**：

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `mode` | `"structured"` | 是 | 结构化模式 |
| `title` | `string` | 否 | 卡片顶部标题 |
| `style` | `string` | 否 | 注入到卡片根元素的 CSS（覆盖颜色、边框等） |
| `data` | `object` | 是 | 战绩数据（见下方） |
| `config` | `object` | 否 | 布局配置（见下方） |

**`data` 字段**：

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `data.layout` | `"scoreboard"` \| `"versus"` | 是 | 布局类型 |
| `data.rows` | `object[]` | scoreboard 必填 | 数据行，每行 key 与 `config.columns[].key` 对应 |
| `data.stats` | `object[]` | 否 | 汇总统计，每项含 `label: string` 和 `values: Record<string, number>` |
| `data.duration` | `number` | 否 | 游戏时长（秒），显示为 `mm:ss` 格式 |
| `data.left` | `{ label, avatar?, score, won? }` | versus 必填 | 对决左方 |
| `data.right` | `{ label, avatar?, score, won? }` | versus 必填 | 对决右方 |

**`config` 字段**：

| 字段 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `columns` | `object[]` | — | 列定义，每列含见下表 |
| `columns[].key` | `string` | — | 对应 `data.rows` 中的字段名 |
| `columns[].label` | `string` | `key` 值 | 列头显示文字 |
| `columns[].align` | `"left"` \| `"center"` \| `"right"` | `"left"` | 水平对齐 |
| `columns[].width` | `string` | `"1fr"` | 列宽（如 `"60px"`、`"2fr"`） |
| `columns[].render` | `"text"` \| `"badge"` \| `"score"` \| `"avatar"` \| `"playerName"` | `"text"` | 渲染模式 |
| `columns[].badgeColors` | `Record<number, string>` | — | badge 渲染时数值到颜色的映射 |
| `highlightTop` | `number` | `3` | 高亮前 N 名（金→银→铜渐变背景） |
| `compact` | `boolean` | `false` | 紧凑模式，缩小间距和字号 |
| `showRank` | `boolean` | `true` | 是否显示排名序号列 |
| `rankLabel` | `string` | — | 排名标签，`{n}` 替换为序号 |
| `rowStyle` | `string` | — | 注入每行的 CSS，`{rowIndex}` 替换为行号 |
| `separator` | `string` | `" : "` | versus 比分分隔符 |
| `scoreFontSize` | `number` | `32` | versus 比分字号（px） |
| `leftStyle` / `rightStyle` | `string` | — | versus 左右两侧注入的 CSS |

**`render` 模式**：

| 值 | 效果 |
| :--- | :--- |
| `"text"` | 纯文本 |
| `"badge"` | 彩色圆角徽章，颜色由 `badgeColors` 按数值映射 |
| `"score"` | 大号加粗分数 |
| `"avatar"` | 玩家头像，平台自动从房间玩家列表反查 |
| `"playerName"` | 玩家昵称（含昵称样式），平台自动反查 |

**模式三：自定义 HTML/CSS**

```json
{
  "mode": "custom",
  "html": "<div class='my-score'><h2>棋局结束</h2><p>红方用时 8:32 获胜</p></div>",
  "css": ".my-score { padding: 16px; border-radius: 12px; background: linear-gradient(135deg, #1a1a2e, #16213e); color: #e0e0e0; text-align: center; }",
  "theme": "dark"
}
```

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `mode` | `"custom"` | 是 | 自定义模式 |
| `html` | `string` | 是 | HTML 片段（不含 `<html>`/`<body>` 标签） |
| `css` | `string` | 否 | 注入到 `<style>` 块的 CSS |
| `theme` | `"dark"` \| `"light"` \| `"auto"` | 否 | 主题，平台据此注入 `color-scheme` 和基础背景色 |

**安全说明**：自定义内容在 `sandbox="allow-scripts"` iframe 中渲染，与主页面隔离。可运行 JavaScript（chart.js、canvas 动画等），但 sandbox 限制使其无法访问父页面。`html + css` 总长不超过 128 KB。

**Response**

```json
{ "success": true }
```

**行为**：报告以系统聊天消息展示，房间内所有玩家可见。不结束进程、不改变房间状态。一局可多次调用（如回合结算）。

---

#### `game.end` — 结束（预留）

> 预留接口，当前仅返回 `{ success: true }`，无实际效果。

**Request**

```json
{ "reason": "win" }
```

**Response**

```json
{ "success": true }
```

---

#### 重连机制

客机游戏进程意外崩溃后，玩家可在 UI 点击"重连"重新启动游戏。重连时平台以相同 `BZ_ROOM_ID` 启动游戏。

**游戏判断是否重连**：`auth` 后调用 `room.getInfo()`，检查 `reconnectPlayerIds` 是否包含自己的 `playerId`。

| 游戏类型 | 推荐策略 |
| :--- | :--- |
| 消息驱动型（棋牌、回合制） | 直接加入当前对局，继续收发消息 |
| 实时动作型（飞行、射击） | 新进程无法恢复运行时状态，建议展示"等待下一局"界面 |

> 平台不强制支持重连。未处理时最差体验为"新实例在房间中重启"。

---

### 5.3 房间

#### `room.getInfo` — 获取房间信息

获取当前房间的完整状态。**单机模式时返回 `null`**。

**Request**

```json
{}
```

**Response**

```json
{
  "id": "room-uuid",
  "gameId": "com.studio.game",
  "gameVersion": "1.0.0",
  "hostId": "p-123",
  "players": [
    { "id": "p-123", "name": "HostPlayer",   "isHost": true,  "isReady": true,  "joinedAt": 1713333333000 },
    { "id": "p-456", "name": "ClientPlayer", "isHost": false, "isReady": false, "joinedAt": 1713333340000 }
  ],
  "maxPlayers": 4,
  "state": "waiting",
  "reconnectPlayerIds": [],
  "createdAt": 1713333330000
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 房间 ID |
| `gameId` | `string` | 游戏 ID |
| `gameVersion` | `string` | 游戏版本号 |
| `hostId` | `string` | 房主玩家 ID |
| `hostPublicAddress` | `string?` | 房主公网地址（仅官方服务器模式） |
| `players` | `PlayerInRoom[]` | 玩家列表（见下表） |
| `maxPlayers` | `number` | 最大玩家数 |
| `state` | `"waiting"` \| `"starting"` \| `"playing"` \| `"ended"` | 房间状态 |
| `reconnectPlayerIds` | `string[]` | 需要重连游戏进程的玩家 ID 列表 |
| `createdAt` | `number` | 房间创建时间戳（毫秒） |

**`state` 含义**：

| 值 | 含义 |
| :--- | :--- |
| `"waiting"` | 等待玩家就绪，尚未开始游戏 |
| `"starting"` | 正在启动游戏进程（短暂） |
| `"playing"` | 游戏进行中 |
| `"ended"` | 游戏已结束 |

**`PlayerInRoom` 字段**：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 玩家 ID |
| `name` | `string` | 玩家昵称 |
| `avatar` | `string?` | 玩家头像（Base64 Data URL） |
| `avatarFrame` | `string?` | 头像框 ID |
| `nicknameStyle` | `object?` | 昵称样式 |
| `isHost` | `boolean` | 是否为房主 |
| `isReady` | `boolean` | 是否已准备（房主默认为 `true`） |
| `joinedAt` | `number` | 加入时间戳（毫秒） |

**`reconnectPlayerIds`**：当非房主玩家在 `"playing"` 状态下断开连接（进程崩溃或网络断开），其 ID 被加入此列表。重连启动时游戏可通过此字段判断重连场景。

---

### 5.4 v1 通信

v1 提供基础的广播和单播能力。未声明 `protocolVersion: 2` 的游戏使用此层。

#### `message.broadcast` — 广播消息

向房间内**除自己以外**的所有玩家发送消息。平台自动补齐 `senderId`、`messageId`、`sentAt`，不会回传给发送者。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `data` | `any` | 是 | 消息内容，任意 JSON 可序列化的值 |
| `contentType` | `"text"` \| `"audio"` \| `"json"` \| `"binary"` | 否 | 内容类型，默认 `"json"` |

```json
{
  "data": { "type": "move", "x": 1, "y": 2 },
  "contentType": "text"
}
```

**Response**

```json
{ "success": true }
```

---

#### `message.send` — 单播消息

向指定玩家发送消息。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `to` | `string` | 条件必填 | 目标玩家 ID（与 `targetPlayerId` 二选一，优先 `to`） |
| `targetPlayerId` | `string` | 条件必填 | 目标玩家 ID（与 `to` 二选一） |
| `data` | `any` | 是 | 消息内容 |
| `contentType` | `"text"` \| `"audio"` \| `"json"` \| `"binary"` | 否 | 内容类型，默认 `"json"` |

```json
{
  "to": "p-456",
  "data": { "content": "Hello" },
  "contentType": "text"
}
```

**校验规则**：

- 必须提供 `to` 或 `targetPlayerId` 之一
- 不允许发送给自己

**Response**

```json
{ "success": true }
```

---

### 5.5 v2 通信

v2 在 v1 基础上增加频道发布、批量消息、频道订阅、二进制帧、可靠确认、结构化错误。适合高频同步和状态广播。

> 必须在 `auth` 时传入 `"protocolVersion": 2` 激活。

#### 5.5.1 Capabilities — 能力声明

v2 认证成功后返回的能力上限：

| 字段 | 值 | 说明 |
| :--- | :--- | :--- |
| `protocolVersion` | `2` | 协议版本 |
| `maxMessageBytes` | `131072` | JSON text frame 最大字节数 |
| `maxBinaryBytes` | `1048576` | Binary frame 最大总字节数（含 header + body） |
| `maxBatchMessages` | `64` | `message.batch` 单批最大消息数 |
| `supportsPublish` | `true` | 支持 `message.publish` |
| `supportsBatch` | `true` | 支持 `message.batch` |
| `supportsAck` | `true` | 支持 `event.messageAck` |
| `supportsSubscribe` | `true` | 支持 `message.subscribe` / `message.unsubscribe` |
| `supportsDelivery` | `true` | 支持 `delivery` 元数据 |
| `supportsBinaryContentType` | `true` | 支持 `contentType: "binary"` |
| `supportsBinaryFrames` | `true` | 支持 WebSocket binary frame |

---

#### `message.publish` — 频道广播

在指定频道上发布消息，广播给房间内其他玩家。与 `message.broadcast` 相比多了 `channel`、`seq`、`delivery` 字段。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `channel` | `string` | 否 | 频道名，默认 `"default"` |
| `seq` | `number` | 否 | 消息序号，用于判断乱序或跳帧 |
| `delivery` | `"reliable"` \| `"ordered"` \| `"latest"` \| `"unreliable"` | 否 | 投递语义，默认 `"reliable"` |
| `data` | `any` | 否 | 消息内容（二进制帧时在 body 中，此处不传） |
| `contentType` | `string` | 否 | 内容类型，默认 `"json"` |

```json
{
  "channel": "state",
  "seq": 1024,
  "delivery": "latest",
  "data": { "x": 10, "y": 20 },
  "contentType": "json"
}
```

**`delivery` 说明**：

| 值 | 用途 |
| :--- | :--- |
| `"reliable"` | 可靠投递，中继成功后推送 `event.messageAck` |
| `"ordered"` | 有序投递，平台按 `seq` 去重和排序 |
| `"latest"` | 仅保留最新消息，旧消息可能被丢弃 |
| `"unreliable"` | 尽力投递，可能丢失 |

平台自动补齐 `senderId`、`messageId`、`sentAt`、`mode: "publish"`。

**Response**

```json
{ "success": true }
```

---

#### `message.batch` — 批量消息

将多条消息打包为一次请求，减少 JSON 编解码开销。平台在目标侧拆分为多条 `event.message`。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `channel` | `string` | 否 | 频道名，子消息继承此频道 |
| `messages` | `object[]` | 是 | 消息数组，每条格式同 `message.publish` |

```json
{
  "channel": "frame",
  "messages": [
    { "seq": 1, "data": { "key": "left" } },
    { "seq": 2, "data": { "key": "jump" } }
  ]
}
```

**限制**：单批最多 64 条，单条 JSON frame 不超过 128 KB。

**Response**

```json
{ "success": true }
```

---

#### `message.subscribe` / `message.unsubscribe` — 频道订阅

按频道过滤 `event.message`，只接收已订阅频道的消息。默认订阅 `"*"`（所有频道）。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `channels` | `string[]` | 是 | 要订阅/取消订阅的频道列表 |

```json
{ "channels": ["state", "input"] }
```

**Response**

```json
{ "success": true, "channels": ["state", "input"] }
```

**行为**：订阅是叠加的；取消订阅后若集合为空，自动恢复 `"*"`。

---

#### 5.5.5 结构化错误

v2 通信接口失败时返回结构化错误对象：

```json
{
  "id": "req-1",
  "type": "response",
  "action": "message.send",
  "error": {
    "code": "TARGET_NOT_FOUND",
    "message": "Target player is not in room",
    "detail": { "targetPlayerId": "p-404" }
  }
}
```

| `error` 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `string` | 错误码 |
| `message` | `string` | 人类可读的错误描述 |
| `detail` | `object?` | 附加详情，视错误类型而定 |

**错误码列表**：

| 错误码 | 含义 |
| :--- | :--- |
| `UNKNOWN_ACTION` | 未知的 action |
| `INVALID_PAYLOAD` | payload 格式无效 |
| `NOT_IN_ROOM` | 当前不在房间中 |
| `MISSING_TARGET` | 缺少目标玩家 ID |
| `TARGET_SELF` | 不允许发送给自己 |
| `TARGET_NOT_FOUND` | 目标玩家不在房间中 |
| `MESSAGE_TOO_LARGE` | 消息体积超限 |
| `BATCH_TOO_LARGE` | 批量消息条数超限 |
| `EMPTY_BATCH` | 批量消息为空 |

---

### 5.6 成就系统

#### `achievement.list` — 获取成就列表

获取当前游戏所有已定义成就及其解锁状态。

**Request**

```json
{}
```

**Response**

```json
[
  {
    "id": "first_win",
    "title": "初次胜利",
    "description": "赢得一场比赛",
    "unlocked": false,
    "unlockedAt": null
  }
]
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 成就 ID，对应 `game.json` |
| `title` | `string` | 成就标题 |
| `description` | `string` | 成就描述 |
| `unlocked` | `boolean` | 是否已解锁 |
| `unlockedAt` | `number?` | 首次解锁时间戳（毫秒），未解锁为 `null` |

---

#### `achievement.unlock` — 解锁成就

触发成就解锁。重复解锁自动忽略（幂等）。

**Request**

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `achievementId` | `string` | 是 | 成就 ID，对应 `game.json` |
| `playerId` | `string` | 否 | 玩家 ID。不填则自动使用当前玩家；填写但与当前玩家不匹配则返回失败 |

```json
{
  "achievementId": "first_win",
  "playerId": "p-123"
}
```

**Response（成功）**

```json
{
  "success": true,
  "new": true
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `success` | `boolean` | 是否成功 |
| `new` | `boolean` | 是否首次解锁 |

**Response（失败）**

```json
{ "success": false, "reason": "Player mismatch" }
```

---

### 5.7 统计系统

#### `stats.report` — 上报统计数据

上报游戏内统计数据。统计项需在 `game.json` 的 `statistics` 字段中预先定义。

> `time`（游玩时长）由平台自动统计，**无需上报**。

**`game.json` 中 `statistics` 的定义方式**：

```json
[
  "kills",
  { "score": "得分" },
  { "endless_high_score": { "label": "无尽最高分", "mode": "full" } }
]
```

| `mode` 值 | 含义 |
| :--- | :--- |
| `"increment"`（默认） | 增量：每次上报值累加到已有值 |
| `"full"` | 全量：直接用上报值覆盖已有值 |

**Request**

```json
{
  "kills": 5,
  "score": 100,
  "endless_high_score": 12000
}
```

payload 的 key 必须与 `game.json` 中定义的统计项名称一致。

**Response**

```json
{ "success": true }
```

---

## 六、 事件通知

平台以 `type = "event"` 的消息向游戏推送通知。游戏在 `onmessage` 中按 `action` 分派处理。

---

### 6.1 `event.message` — 收到消息

其他玩家调用 `message.broadcast`、`message.send` 或 `message.publish` 时触发。

**Payload**

```json
{
  "senderId": "p-456",
  "messageId": "msg-uuid",
  "sentAt": 1713333333333,
  "channel": "default",
  "mode": "broadcast",
  "delivery": "reliable",
  "contentType": "json",
  "seq": 1,
  "data": { "type": "move", "x": 10 }
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `senderId` | `string` | 发送者玩家 ID（平台补齐） |
| `messageId` | `string` | 消息唯一 ID（平台补齐，建议用于去重） |
| `sentAt` | `number` | 发送时间戳毫秒（平台补齐） |
| `channel` | `string` | 频道名 |
| `mode` | `"direct"` \| `"broadcast"` \| `"publish"` \| `"batch"` | 发送模式 |
| `delivery` | `"reliable"` \| `"ordered"` \| `"latest"` \| `"unreliable"` | 投递语义 |
| `contentType` | `"json"` \| `"text"` \| `"audio"` \| `"binary"` | 内容类型 |
| `seq` | `number?` | 消息序号 |
| `data` | `any` | 对方发送的数据 |
| `binary` | `boolean?` | 二进制帧时为 `true` |
| `byteLength` | `number?` | 二进制帧时的 body 字节数 |

**去重建议**：使用 `messageId` 做幂等判断。

**二进制接收**：若以 binary frame 推送，JSON header 中 `payload` 仅含元数据，body 为原始字节。处理方式见 [4.5](#45-v2-二进制帧)。

---

### 6.2 `event.messageAck` — 可靠消息确认

当消息 `delivery` 为 `"reliable"` 时，平台中继成功后推送确认。

> 仅 v2 协议支持。

**Payload**

```json
{
  "messageId": "msg-uuid",
  "senderId": "p-123",
  "to": "p-123",
  "sentAt": 1713333333444
}
```

---

### 6.3 预留事件

以下事件已在类型定义中存在，**当前版本尚未实际推送**。开发者无需编写处理逻辑。

| 事件 | Payload | 说明 |
| :--- | :--- | :--- |
| `event.playerJoined` | `{ "player": { "id": "...", "name": "..." } }` | 新玩家加入通知 |
| `event.playerLeft` | `{ "playerId": "..." }` | 玩家离开通知 |
| `event.gameEnd` | `{ "reason": "..." }` | 游戏结束通知 |

> **替代方案**：调用 `room.getInfo()` 获取最新玩家列表和房间状态。

---

## 七、 快速集成示例

以下示例涵盖连接、认证、就绪、房间信息、消息收发和战绩上报。

```javascript
// ── 1. 获取配置 ──
function getConfig() {
  if (window.BZ_CONFIG) return window.BZ_CONFIG;
  const p = new URLSearchParams(location.search);
  return {
    apiPort: p.get('apiPort'),
    token: p.get('token'),
    playerId: p.get('playerId'),
    playerName: 'Unknown',
    isMultiple: p.get('isMultiple') === '1'
  };
}

const config = getConfig();
let ws = null;
const pending = new Map();  // 请求 ID → { resolve, reject }

// ── 2. 连接 ──
function connect() {
  if (!config.apiPort) return console.error('未找到 BZ-Games 配置');
  ws = new WebSocket(`ws://127.0.0.1:${config.apiPort}`);
  ws.onopen = () => {
    console.log('已连接');
    sendRequest('auth', { token: config.token });
  };
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      handleBinary(event.data);
      return;
    }
    const msg = JSON.parse(event.data);
    if (msg.type === 'response') handleResponse(msg);
    if (msg.type === 'event')   handleEvent(msg);
  };
  ws.onclose = () => console.log('连接断开');
}

// ── 3. 请求封装（返回 Promise） ──
function sendRequest(action, payload) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type: 'request', action, payload }));
  });
}

// ── 4. 响应处理 ──
function handleResponse(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) {
    p.reject(new Error(typeof msg.error === 'string' ? msg.error : msg.error.message));
    return;
  }
  p.resolve(msg.payload);
}

// ── 5. 游戏初始化 ──
async function initGame() {
  const auth = await sendRequest('auth', { token: config.token });
  console.log('我是:', auth.player.name, auth.player.isHost ? '(房主)' : '');

  const room = await sendRequest('room.getInfo', {});
  if (room) {
    console.log('联机模式, 状态:', room.state);
    if (room.reconnectPlayerIds.includes(config.playerId)) {
      console.log('这是重连启动');
    }
  }

  await sendRequest('game.ready', {});
  console.log('就绪');
}

// ── 6. 事件处理 ──
function handleEvent(evt) {
  switch (evt.action) {
    case 'event.message': {
      const { senderId, data } = evt.payload;
      console.log(`收到 ${senderId}:`, data);
      break;
    }
    case 'event.messageAck':
      console.log('消息已确认:', evt.payload.messageId);
      break;
  }
}

// ── 7. 发送消息 ──
function broadcast(data) {
  sendRequest('message.broadcast', { data });
}

function sendTo(playerId, data) {
  sendRequest('message.send', { to: playerId, data });
}

// ── 8. 上报战绩 ──
function reportResult(results) {
  sendRequest('game.report', {
    mode: 'structured',
    title: '本局结果',
    data: { layout: 'scoreboard', rows: results, duration: 1205 },
    config: {
      columns: [
        { key: 'playerId', label: '玩家', render: 'playerName', width: '2fr' },
        { key: 'score',    label: '分数', render: 'score', align: 'right' }
      ]
    }
  });
}

// ── 9. 二进制帧处理 ──
function handleBinary(data) {
  const view = new DataView(data);
  const hl = view.getUint32(0, false);
  const headerBytes = new Uint8Array(data, 4, hl);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  const body = data.slice(4 + hl);
  if (header.action === 'event.message' && header.payload.contentType === 'binary') {
    const values = new Float32Array(body);
    console.log(`二进制消息:`, header.payload.senderId, values);
  }
}

// ── 启动 ──
connect();
```
