export class RoomConstants {
  // 最近已处理游戏中继消息 ID 的保留数量，用于去重并限制内存占用。
  static readonly MAX_RECENT_MESSAGE_IDS = 1000;

  // 单条房间消息最大字节数，覆盖聊天图片、房间状态、系统事件等普通房间消息。
  static readonly MAX_ROOM_MESSAGE_BYTES = 24 * 1024 * 1024;

  // 单条游戏实时中继消息最大字节数，用于限制 game:message:relay / game:broadcast:relay 大小。
  static readonly MAX_GAME_RELAY_MESSAGE_BYTES = 1024 * 1024;

  // 房间 WebSocket 心跳检测间隔，服务端按该间隔 ping 客户端。
  static readonly ROOM_HEARTBEAT_INTERVAL_MS = 30_000;

  // 房主解散房间时，广播 room:disbanded 后等待该时长再关闭连接。
  static readonly ROOM_DISBAND_BROADCAST_DELAY_MS = 120;

  // 客户端加入房间的连接超时时间。
  static readonly ROOM_CONNECT_TIMEOUT_MS = 15_000;

  // 客户端断线后的最大自动重连次数。
  static readonly ROOM_MAX_RECONNECT_ATTEMPTS = 5;

  static readonly RELAY_LATENCY_REFRESH_INTERVAL_MS = 10_000;

  static readonly RELAY_LATENCY_TIMEOUT_MS = 5_000;

  // 客户端自动重连的基础退避时间，每次重连按 attempts * base 计算。
  static readonly ROOM_RECONNECT_BASE_DELAY_MS = 2_000;

  // 客户端自动重连的最大退避时间。
  static readonly ROOM_RECONNECT_MAX_DELAY_MS = 10_000;

  // Game API JSON text frame 最大字节数，用于控制面和普通 JSON 通信。
  static readonly GAME_API_MAX_MESSAGE_BYTES = 128 * 1024;

  // Game API v2 WebSocket binary frame 最大总字节数，包含 headerLength、header 和 body。
  static readonly GAME_API_MAX_BINARY_BYTES = 1024 * 1024;

  // Game API v2 message.batch 单批最大子消息数量。
  static readonly GAME_API_MAX_BATCH_MESSAGES = 64;

  // game.report 自定义 HTML + CSS 总长最大字节数。
  static readonly GAME_REPORT_HTML_MAX_BYTES = 128 * 1024;

  // Game API 启动后等待游戏进程连接的最长时间，超时且无客户端连接时自动停止。
  static readonly GAME_API_STARTUP_TIMEOUT_MS = 60_000;

  // Game API WebSocket 连接建立后等待 auth 请求的最长时间。
  static readonly GAME_API_AUTH_TIMEOUT_MS = 60_000;

  // Game API 最后一个客户端断开后延迟关闭服务的时间。
  static readonly GAME_API_SHUTDOWN_DELAY_MS = 5_000;

  // Game API v2 频道订阅通配符，表示接收全部频道事件。
  static readonly GAME_API_CHANNEL_ALL = "*";

  // base64 内容启发式识别的最小字符串长度，避免把短文本误判为二进制内容。
  static readonly BASE64_DETECTION_MIN_LENGTH = 32;
}
