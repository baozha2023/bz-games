import { ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";

type SerializableValue =
  | null
  | boolean
  | number
  | string
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeLogArg(arg: any, seen: WeakSet<object> = new WeakSet()): SerializableValue {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }
  if (arg === null || arg === undefined) {
    return null;
  }
  const valueType = typeof arg;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return arg;
  }
  if (valueType === "bigint") {
    return arg.toString();
  }
  if (valueType === "symbol") {
    return arg.toString();
  }
  if (valueType === "function") {
    return `[Function ${arg.name || "anonymous"}]`;
  }
  if (Array.isArray(arg)) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    return arg.map((item) => normalizeLogArg(item, seen));
  }
  if (arg instanceof Map) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    return {
      type: "Map",
      entries: Array.from(arg.entries()).map(([key, value]) => [normalizeLogArg(key, seen), normalizeLogArg(value, seen)]),
    };
  }
  if (arg instanceof Set) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    return {
      type: "Set",
      values: Array.from(arg.values()).map((value) => normalizeLogArg(value, seen)),
    };
  }
  if (arg instanceof Date) {
    return arg.toISOString();
  }
  if (arg instanceof RegExp) {
    return arg.toString();
  }
  if (ArrayBuffer.isView(arg)) {
    if (!("length" in arg)) {
      return {
        type: arg.constructor?.name || "ArrayBufferView",
        byteLength: arg.byteLength,
      };
    }
    return {
      type: arg.constructor?.name || "TypedArray",
      values: Array.from(arg as unknown as ArrayLike<number>).map((value) => value),
    };
  }
  if (arg instanceof ArrayBuffer) {
    return {
      type: "ArrayBuffer",
      byteLength: arg.byteLength,
    };
  }
  if (typeof Node !== "undefined" && arg instanceof Node) {
    const node = arg as Node & { outerHTML?: string; nodeName?: string };
    return {
      type: node.nodeName || "Node",
      outerHTML: typeof node.outerHTML === "string" ? node.outerHTML : undefined,
    };
  }
  if (isPlainObject(arg)) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    const result: Record<string, SerializableValue> = {};
    for (const [key, value] of Object.entries(arg)) {
      result[key] = normalizeLogArg(value, seen);
    }
    return result;
  }
  try {
    return JSON.parse(JSON.stringify(arg)) as SerializableValue;
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

const mainWorldForwardingSource = String.raw`
(() => {
  if (window.__bzGamesErrorForwardingInstalled) return;
  window.__bzGamesErrorForwardingInstalled = true;

  const nativeConsoleError = console.error.bind(console);

  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function normalizeLogArg(arg, seen = new WeakSet()) {
    if (arg instanceof Error) {
      return {
        name: arg.name,
        message: arg.message,
        stack: arg.stack,
      };
    }
    if (arg === null || arg === undefined) return null;
    const valueType = typeof arg;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") return arg;
    if (valueType === "bigint" || valueType === "symbol") return arg.toString();
    if (valueType === "function") return "[Function " + (arg.name || "anonymous") + "]";
    if (Array.isArray(arg)) {
      if (seen.has(arg)) return "[Circular]";
      seen.add(arg);
      return arg.map((item) => normalizeLogArg(item, seen));
    }
    if (arg instanceof Map) {
      if (seen.has(arg)) return "[Circular]";
      seen.add(arg);
      return {
        type: "Map",
        entries: Array.from(arg.entries()).map(([key, value]) => [normalizeLogArg(key, seen), normalizeLogArg(value, seen)]),
      };
    }
    if (arg instanceof Set) {
      if (seen.has(arg)) return "[Circular]";
      seen.add(arg);
      return {
        type: "Set",
        values: Array.from(arg.values()).map((value) => normalizeLogArg(value, seen)),
      };
    }
    if (arg instanceof Date) return arg.toISOString();
    if (arg instanceof RegExp) return arg.toString();
    if (ArrayBuffer.isView(arg)) {
      if (!("length" in arg)) {
        return {
          type: arg.constructor?.name || "ArrayBufferView",
          byteLength: arg.byteLength,
        };
      }
      return {
        type: arg.constructor?.name || "TypedArray",
        values: Array.from(arg),
      };
    }
    if (arg instanceof ArrayBuffer) {
      return {
        type: "ArrayBuffer",
        byteLength: arg.byteLength,
      };
    }
    if (typeof Node !== "undefined" && arg instanceof Node) {
      return {
        type: arg.nodeName || "Node",
        outerHTML: typeof arg.outerHTML === "string" ? arg.outerHTML : undefined,
      };
    }
    if (isPlainObject(arg)) {
      if (seen.has(arg)) return "[Circular]";
      seen.add(arg);
      const result = {};
      for (const [key, value] of Object.entries(arg)) {
        result[key] = normalizeLogArg(value, seen);
      }
      return result;
    }
    try {
      return JSON.parse(JSON.stringify(arg));
    } catch {
      return Object.prototype.toString.call(arg);
    }
  }

  function forward(args) {
    window.dispatchEvent(new CustomEvent("bz-games:renderer-error", {
      detail: args.map((arg) => normalizeLogArg(arg)),
    }));
  }

  console.error = (...args) => {
    nativeConsoleError(...args);
    forward(args);
  };

  window.addEventListener("error", (event) => {
    console.error("[__BZ_ERROR_PREFIX__] Unhandled error", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[__BZ_ERROR_PREFIX__] Unhandled rejection", event.reason);
  });
})();`;

function installMainWorldForwarding(errorPrefix: string) {
  if (!process.contextIsolated) return;
  window.addEventListener("bz-games:renderer-error", (event) => {
    const detail = (event as CustomEvent).detail;
    ipcRenderer.send(IPC.SYSTEM_LOG_ERROR, Array.isArray(detail) ? detail : [normalizeLogArg(detail)]);
  });
  const source = mainWorldForwardingSource.replaceAll("__BZ_ERROR_PREFIX__", errorPrefix);
  const inject = () => {
    const script = document.createElement("script");
    script.textContent = source;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  };
  if (document.documentElement) {
    inject();
  } else {
    window.addEventListener("DOMContentLoaded", inject, { once: true });
  }
}

export function installErrorForwarding(errorPrefix: string) {
  const nativeConsoleError = console.error.bind(console);
  const shouldWriteErrorToConsole = process.env.NODE_ENV === "development" || !!process.env.ELECTRON_RENDERER_URL;

  console.error = (...args: any[]) => {
    if (shouldWriteErrorToConsole) {
      nativeConsoleError(...args);
    }
    ipcRenderer.send(IPC.SYSTEM_LOG_ERROR, args.map((arg) => normalizeLogArg(arg)));
  };

  if (process.contextIsolated) {
    installMainWorldForwarding(errorPrefix);
  } else {
    window.addEventListener("error", (event) => {
      console.error(`[${errorPrefix}] Unhandled error`, event.error || event.message);
    });

    window.addEventListener("unhandledrejection", (event) => {
      console.error(`[${errorPrefix}] Unhandled rejection`, event.reason);
    });
  }
}
