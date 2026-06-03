# BZ-Games Game API v1 / v2 接口说明

本文档描述 BZ-Games 平台 Game API 的连接方式、固定平台接口、v1 通信接口、v2 通信接口、二进制帧格式、平台推送事件和结构化错误码。

## 协议总览

| 项目 | v1 | v2 |
|---|---|---|
| 定位 | 基础联机通信 API | 高频实时通信 API |
| 连接地址 | `ws://127.0.0.1:{apiPort}` | `ws://127.0.0.1:{apiPort}` |
| 认证方式 | `auth.payload` 传 `{ token }` | `auth.payload` 传 `{ token, protocolVersion: 2 }` |
| 通信帧 | JSON WebSocket text frame | JSON WebSocket text frame 和 WebSocket binary frame |
| 通信接口 | `message.send`、`message.broadcast` | `message.send`、`message.broadcast`、`message.publish`、`message.batch`、`message.subscribe`、`message.unsubscribe` |
| 主要用途 | 聊天、回合制事件、棋牌、轻量同步 | 高频输入、状态同步、频道事件、二进制快照 |

## 协议识别

- 游戏连接本地 Game API WebSocket 地址后首先发送 `auth` 请求。
- 平台根据 `auth.payload.protocolVersion` 绑定连接协议版本。
- `auth.payload.protocolVersion` 为 `2` 时，连接使用 v2 通信协议。
- `auth.payload.protocolVersion` 未传或不是 `2` 时，连接使用 v1 通信协议。
- 连接完成认证后，该连接的通信协议版本保持固定。
- `GameApiServer` 负责连接、认证、平台固定接口、协议路由和事件下发。
- `V1GameApiProtocol` 负责 v1 通信接口。
- `V2GameApiProtocol` 负责 v2 通信接口。
- `GameApiErrorCode` 统一定义 Game API 结构化错误码。

## 平台固定接口

平台固定接口是所有协议版本共享的平台能力。平台固定接口使用 JSON WebSocket text frame。

### `auth`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ token: string, protocolVersion?: 2 }`
- v1 响应：`{ success: true, player: { id, name, isHost }, protocolVersion: 1 }`
- v2 响应：`{ success: true, player: { id, name, isHost }, protocolVersion: 2, capabilities }`
- 说明：游戏在连接建立后发送认证请求。平台认证成功后返回当前玩家信息和连接协议版本。

### `game.ready`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{}`
- 响应：`{ acknowledged: true }`
- 说明：游戏通知平台当前游戏实例已经准备完成。

### `player.getInfo`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{}`
- 响应：`{ id: string, name: string }`
- 说明：游戏获取当前本地玩家信息。

### `room.getInfo`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{}`
- 响应：`RoomInfo | null`
- 说明：游戏获取当前房间信息。玩家不在房间时响应为 `null`。

### `game.end`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ reason?: string }`
- 响应：`{ success: true }`
- 说明：游戏通知平台本局游戏结束。

### `achievement.list`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{}`
- 响应：`Achievement[]`
- 说明：游戏获取当前游戏的成就列表和解锁状态。

### `achievement.unlock`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ achievementId: string, playerId?: string }`
- 响应：`{ success: true, new: boolean }`
- 说明：游戏解锁当前本地玩家的指定成就。

### `stats.report`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`Record<string, number>`
- 响应：`{ success: true }`
- 说明：游戏上报统计数据。统计项由游戏 manifest 定义。

## v1 通信接口

v1 通信接口使用 JSON WebSocket text frame。v1 通信接口包含单播和广播。

### `message.send`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ to?: string, targetPlayerId?: string, data: unknown, contentType?: "text" | "audio" | "json" | "binary" }`
- 响应：`{ success: true }`
- 平台补齐字段：`senderId`、`messageId`、`sentAt`、`contentType`
- 投递目标：指定目标玩家
- 参数规则：`to` 和 `targetPlayerId` 均表示目标玩家 ID。平台优先使用 `to`，没有 `to` 时使用 `targetPlayerId`。
- 校验规则：目标玩家在当前房间中，且目标玩家不是发送者本人。
- 说明：该接口用于向指定玩家发送游戏消息。

### `message.broadcast`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ data: unknown, contentType?: "text" | "audio" | "json" | "binary" }`
- 响应：`{ success: true }`
- 平台补齐字段：`senderId`、`messageId`、`sentAt`、`contentType`
- 投递目标：房间内除自己外的其他玩家
- 说明：该接口用于向房间内其他玩家广播游戏消息。

## v2 通信接口

v2 通信接口使用 JSON WebSocket text frame 和 WebSocket binary frame。JSON text frame 用于控制消息和普通数据消息。WebSocket binary frame 用于承载原始二进制 body。

### `message.send`

- 方向：Game → Platform
- 传输：JSON text frame 或 WebSocket binary frame
- 请求参数：`{ to: string, data?: unknown, channel?: string, seq?: number, delivery?: Delivery, reliable?: boolean, contentType?: ContentType }`
- 响应：`{ success: true }`
- 平台补齐字段：`senderId`、`messageId`、`sentAt`、`channel`、`seq`、`mode: "direct"`、`delivery`、`contentType`
- 投递目标：指定目标玩家
- 参数规则：`to` 表示目标玩家 ID。
- 校验规则：目标玩家在当前房间中，且目标玩家不是发送者本人。
- 二进制规则：使用 WebSocket binary frame 时，原始二进制数据位于 body 中。
- 说明：该接口用于向指定玩家发送 v2 游戏消息。

### `message.broadcast`

- 方向：Game → Platform
- 传输：JSON text frame 或 WebSocket binary frame
- 请求参数：`{ data?: unknown, channel?: string, seq?: number, delivery?: Delivery, reliable?: boolean, contentType?: ContentType }`
- 响应：`{ success: true }`
- 平台补齐字段：`senderId`、`messageId`、`sentAt`、`channel`、`seq`、`mode: "broadcast"`、`delivery`、`contentType`
- 投递目标：房间内除自己外的其他玩家
- 二进制规则：使用 WebSocket binary frame 时，原始二进制数据位于 body 中。
- 说明：该接口用于向房间内其他玩家广播 v2 游戏消息。

### `message.publish`

- 方向：Game → Platform
- 传输：JSON text frame 或 WebSocket binary frame
- 请求参数：`{ data?: unknown, channel?: string, seq?: number, delivery?: Delivery, reliable?: boolean, contentType?: ContentType }`
- 响应：`{ success: true }`
- 平台补齐字段：`senderId`、`messageId`、`sentAt`、`channel`、`seq`、`mode: "publish"`、`delivery`、`contentType`
- 投递目标：房间内除自己外的其他玩家
- 频道规则：`channel` 表示消息频道。未传 `channel` 时平台使用 `"default"`。
- 二进制规则：使用 WebSocket binary frame 时，原始二进制数据位于 body 中。
- 说明：该接口用于发布频道化实时同步消息。

### `message.batch`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ channel?: string, messages: Array<MessagePayload> }`
- 响应：`{ success: true }`
- 平台补齐字段：`senderId`、`messageId`、`sentAt`、`channel`、`mode: "batch"`、`delivery`、`contentType`、`messages`
- 投递目标：房间内除自己外的其他玩家
- 数量限制：`messages.length` 最大为 `maxBatchMessages`。
- 说明：该接口用于一次提交多条 v2 消息。

### `message.subscribe`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ channel?: string, channels?: string[] }`
- 响应：`{ success: true, channels: string[] }`
- 说明：游戏订阅一个或多个本地接收频道。平台按订阅频道过滤发给该游戏实例的 `event.message`。

### `message.unsubscribe`

- 方向：Game → Platform
- 传输：JSON text frame
- 请求参数：`{ channel?: string, channels?: string[] }`
- 响应：`{ success: true, channels: string[] }`
- 说明：游戏取消订阅一个或多个本地接收频道。订阅集合为空时平台使用 `"*"`。

## v2 参数类型

### `ContentType`

- 类型：`"text" | "audio" | "json" | "binary"`
- 说明：`contentType` 表示消息数据类型。WebSocket binary frame 自动使用 `"binary"`。

### `Delivery`

- 类型：`"reliable" | "ordered" | "latest" | "unreliable"`
- `"reliable"` 表示可靠投递语义。平台完成中继后向发送方发送 `event.messageAck`。
- `"ordered"` 表示有序投递语义。平台按 `senderId + channel` 记录最新 `seq`，并丢弃旧序号消息。
- `"latest"` 表示最新状态语义。该值作为消息元数据随消息中继。
- `"unreliable"` 表示可丢弃语义。该值作为消息元数据随消息中继。
- 默认值：`"reliable"`

### `MessagePayload`

- 结构：`{ data?: unknown, channel?: string, seq?: number, delivery?: Delivery, reliable?: boolean, contentType?: ContentType }`
- 说明：`MessagePayload` 用于 `message.batch.messages[]`。

### `RoomInfo`

- 结构：`{ id, gameId, gameVersion, hostId, hostPublicAddress?, players, maxPlayers, state, createdAt }`
- 说明：`RoomInfo` 表示房间信息。

### `PlayerInRoom`

- 结构：`{ id, name, avatar?, avatarFrame?, isHost, isReady, joinedAt }`
- 说明：`PlayerInRoom` 表示房间内玩家信息。

## v2 能力声明

v2 认证成功响应中的 `capabilities` 描述当前连接支持的 v2 能力。

- `protocolVersion` 的值为 `2`。
- `protocolName` 的值为 `"bz-game-api-v2"`。
- `maxMessageBytes` 表示 JSON text frame 最大字节数，当前值为 `65536`。
- `maxBinaryBytes` 表示单个 WebSocket binary frame 最大总字节数，当前值为 `262144`。
- `maxBatchMessages` 表示 `message.batch` 单批最大消息数，当前值为 `32`。
- `supportsPublish` 表示连接支持 `message.publish`。
- `supportsBatch` 表示连接支持 `message.batch`。
- `supportsAck` 表示连接支持 `event.messageAck`。
- `supportsSubscribe` 表示连接支持 `message.subscribe` 和 `message.unsubscribe`。
- `supportsDelivery` 表示连接支持 `delivery` 元数据。
- `supportsBinaryContentType` 表示连接支持 `contentType: "binary"`。
- `supportsBinaryFrames` 表示连接支持 WebSocket binary frame。

## v2 二进制帧格式

v2 二进制帧是一个 WebSocket binary frame。该 binary frame 由 4 字节 header 长度、JSON header 和原始二进制 body 组成。

| 区段 | 长度 | 编码 | 内容 |
|---|---:|---|---|
| `headerLength` | 4 bytes | UInt32BE | JSON header 的字节长度 |
| `header` | `headerLength` bytes | UTF-8 JSON | 请求或事件元数据 |
| `body` | 剩余字节 | 原始二进制 | 游戏二进制数据 |

### 二进制发送流程

- 游戏完成 v2 `auth` 认证。
- 游戏构造 JSON header。header 包含 `id`、`type`、`action` 和 `payload`。
- 游戏把 JSON header 编码为 UTF-8 字节。
- 游戏把游戏快照、输入帧或状态数据编码为 `Uint8Array`。
- 游戏创建 `4 + headerBytes.length + bodyBytes.length` 长度的 `Uint8Array`。
- 游戏在前 4 字节写入 `headerBytes.length`，编码为 UInt32BE。
- 游戏把 header 字节写入第 4 字节之后。
- 游戏把 body 字节写入 header 之后。
- 游戏调用 `ws.send(frame)` 发送 WebSocket binary frame。

```js
const header = {
  id: crypto.randomUUID(),
  type: "request",
  action: "message.publish",
  payload: {
    channel: "state",
    seq: frameSeq,
    delivery: "latest",
    contentType: "binary",
  },
};

const headerBytes = new TextEncoder().encode(JSON.stringify(header));
const bodyBytes = encodeGameSnapshotToUint8Array(snapshot);
const frame = new Uint8Array(4 + headerBytes.byteLength + bodyBytes.byteLength);
new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, false);
frame.set(headerBytes, 4);
frame.set(bodyBytes, 4 + headerBytes.byteLength);
ws.send(frame);
```

### 二进制接收流程

- 游戏把 `ws.binaryType` 设置为 `"arraybuffer"`。
- 游戏收到 WebSocket binary frame。
- 游戏读取前 4 字节，得到 `headerLength`。
- 游戏读取 `headerLength` 字节，得到 JSON header。
- 游戏读取剩余字节，得到原始二进制 body。
- 游戏解析 JSON header，并把 body 交给游戏自己的二进制解码器。

```js
ws.binaryType = "arraybuffer";
ws.onmessage = (event) => {
  if (typeof event.data === "string") {
    handleJsonEvent(JSON.parse(event.data));
    return;
  }

  const frame = new Uint8Array(event.data);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const headerLength = view.getUint32(0, false);
  const headerBytes = frame.slice(4, 4 + headerLength);
  const bodyBytes = frame.slice(4 + headerLength);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  handleBinaryEvent(header, bodyBytes);
};
```

### 二进制请求 header

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 请求 ID |
| `type` | `"request"` | 请求类型 |
| `action` | `"message.send" | "message.broadcast" | "message.publish"` | 二进制请求 action |
| `payload.to` | `string` | `message.send` 的目标玩家 ID |
| `payload.channel` | `string` | v2 消息频道 |
| `payload.seq` | `number` | v2 消息序号 |
| `payload.delivery` | `Delivery` | v2 投递语义 |
| `payload.contentType` | `"binary"` | 二进制内容类型 |

### 二进制事件 header

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 事件 ID |
| `type` | `"event"` | 事件类型 |
| `action` | `"event.message"` | 消息事件 |
| `payload.senderId` | `string` | 发送者玩家 ID |
| `payload.messageId` | `string` | 消息 ID |
| `payload.sentAt` | `number` | 发送时间 |
| `payload.channel` | `string` | v2 消息频道 |
| `payload.mode` | `"direct" | "broadcast" | "publish"` | v2 消息模式 |
| `payload.delivery` | `Delivery` | v2 投递语义 |
| `payload.contentType` | `"binary"` | 二进制内容类型 |
| `payload.binary` | `true` | 二进制标记 |
| `payload.byteLength` | `number` | body 字节数 |

## 平台推送事件

平台推送事件由平台主动发送给游戏。平台推送事件使用 `type: "event"`。

### `event.message`

- 方向：Platform → Game
- 传输：v1 使用 JSON text frame；v2 使用 JSON text frame 或 WebSocket binary frame
- Payload：`GameRelayPayload`
- 说明：平台向游戏推送其他玩家发送的游戏消息。

### `event.messageAck`

- 方向：Platform → Game
- 传输：JSON text frame
- Payload：`{ messageId: string, senderId: string, to: string, sentAt: number }`
- 说明：平台向可靠消息发送方推送中继确认事件。

## 结构化错误

结构化错误位于响应对象的 `error` 字段中。`error.code` 使用 `GameApiErrorCode` 中定义的值。

| 错误码 | 含义 | 典型接口 |
|---|---|---|
| `UNKNOWN_ACTION` | 请求 action 不属于当前接口集合 | 所有请求 |
| `INVALID_PAYLOAD` | 请求 payload、JSON text frame 或 WebSocket binary frame 格式无效 | 所有请求 |
| `NOT_IN_ROOM` | 当前玩家没有处于房间中 | 通信接口 |
| `MISSING_TARGET` | 单播消息缺少目标玩家 ID | `message.send` |
| `TARGET_SELF` | 单播目标玩家是发送者本人 | `message.send` |
| `TARGET_NOT_FOUND` | 单播目标玩家不在当前房间中 | `message.send` |
| `MESSAGE_TOO_LARGE` | JSON text frame 或 WebSocket binary frame 超过大小限制 | 通信接口 |
| `BATCH_TOO_LARGE` | 批量消息数量超过 `maxBatchMessages` | `message.batch` |
| `EMPTY_BATCH` | 批量消息列表为空 | `message.batch` |
