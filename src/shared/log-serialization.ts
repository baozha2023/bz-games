export type LogSource = "main-window" | "game-window" | "chat-window" | "float-ball" | "notification-window";

export type LogSerializableValue =
  | null
  | boolean
  | number
  | string
  | LogSerializableValue[]
  | { [key: string]: LogSerializableValue };

export interface RendererLogContext {
  source: LogSource;
  url: string;
  userAgent: string;
  timestamp: string;
  gameId?: string;
  version?: string;
}

export interface RendererLogPayload {
  context: RendererLogContext;
  args: LogSerializableValue[];
}

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 20000;
const LOG_SOURCES = new Set<LogSource>(["main-window", "game-window", "chat-window", "float-ball", "notification-window"]);

function truncateString(value: string) {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]` : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDomNodeLike(value: unknown): value is { nodeName?: string; outerHTML?: string } {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { nodeType?: unknown; nodeName?: unknown };
  return typeof candidate.nodeType === "number" && typeof candidate.nodeName === "string";
}

function normalizeLogSource(value: unknown): LogSource {
  return typeof value === "string" && LOG_SOURCES.has(value as LogSource) ? value as LogSource : "main-window";
}

function serializeObjectEntries(entries: Array<[string, unknown]>, seen: WeakSet<object>, depth: number) {
  const result: Record<string, LogSerializableValue> = {};
  for (const [key, value] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[key] = serializeLogArg(value, seen, depth + 1);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }
  return result;
}

export function serializeLogArg(arg: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): LogSerializableValue {
  if (depth > MAX_DEPTH) return "[MaxDepth]";
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: truncateString(arg.message),
      stack: arg.stack ? truncateString(arg.stack) : null,
    };
  }
  if (arg === null || arg === undefined) return null;
  const valueType = typeof arg;
  if (valueType === "string") return truncateString(arg as string);
  if (valueType === "number" || valueType === "boolean") return arg as number | boolean;
  if (valueType === "bigint" || valueType === "symbol") return String(arg);
  if (valueType === "function") return `[Function ${(arg as Function).name || "anonymous"}]`;
  if (typeof arg !== "object") return String(arg);
  if (seen.has(arg)) return "[Circular]";
  seen.add(arg);
  if (Array.isArray(arg)) {
    const values = arg.slice(0, MAX_ARRAY_ITEMS).map((item) => serializeLogArg(item, seen, depth + 1));
    if (arg.length > MAX_ARRAY_ITEMS) values.push(`[truncated ${arg.length - MAX_ARRAY_ITEMS} items]`);
    return values;
  }
  if (arg instanceof Map) {
    return {
      type: "Map",
      size: arg.size,
      entries: Array.from(arg.entries()).slice(0, MAX_ARRAY_ITEMS).map(([key, value]) => [
        serializeLogArg(key, seen, depth + 1),
        serializeLogArg(value, seen, depth + 1),
      ]),
    };
  }
  if (arg instanceof Set) {
    return {
      type: "Set",
      size: arg.size,
      values: Array.from(arg.values()).slice(0, MAX_ARRAY_ITEMS).map((value) => serializeLogArg(value, seen, depth + 1)),
    };
  }
  if (arg instanceof Date) return arg.toISOString();
  if (arg instanceof RegExp) return arg.toString();
  if (ArrayBuffer.isView(arg)) {
    if (!("length" in arg)) {
      return { type: arg.constructor?.name || "ArrayBufferView", byteLength: arg.byteLength };
    }
    const values = Array.from(arg as unknown as ArrayLike<number>).slice(0, MAX_ARRAY_ITEMS);
    return { type: arg.constructor?.name || "TypedArray", length: (arg as unknown as ArrayLike<number>).length, values };
  }
  if (arg instanceof ArrayBuffer) return { type: "ArrayBuffer", byteLength: arg.byteLength };
  if (isDomNodeLike(arg)) {
    return {
      type: arg.nodeName || "Node",
      outerHTML: typeof arg.outerHTML === "string" ? truncateString(arg.outerHTML) : null,
    };
  }
  if (isPlainObject(arg)) return serializeObjectEntries(Object.entries(arg), seen, depth);
  try {
    const jsonValue = JSON.parse(JSON.stringify(arg)) as unknown;
    return serializeLogArg(jsonValue, seen, depth + 1);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

export function serializeLogArgs(args: unknown[]) {
  return args.map((arg) => serializeLogArg(arg));
}

export function formatLogValue(value: unknown): string {
  const serialized = serializeLogArg(value);
  if (typeof serialized === "string") return serialized;
  return JSON.stringify(serialized);
}

export function normalizeRendererLogPayload(value: unknown): RendererLogPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<RendererLogPayload>;
  if (!payload.context || !Array.isArray(payload.args)) return null;
  const context = payload.context as Partial<RendererLogContext>;
  return {
    context: {
      source: normalizeLogSource(context.source),
      url: context.url || "",
      userAgent: context.userAgent || "",
      timestamp: context.timestamp || new Date().toISOString(),
      gameId: context.gameId || undefined,
      version: context.version || undefined,
    },
    args: payload.args.map((arg) => serializeLogArg(arg)),
  };
}
