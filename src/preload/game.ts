import { ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";
import { installErrorForwarding } from "./error-forwarding";

installErrorForwarding("game-window");

function resolveGameIdentity(): { gameId: string; version: string } {
  let gameId = "";
  let version = "";

  const argv = process.argv || [];
  for (const arg of argv) {
    if (!gameId && arg.startsWith("--bz-game-id=")) {
      gameId = arg.slice("--bz-game-id=".length);
    }
    if (!version && arg.startsWith("--bz-game-version=")) {
      version = arg.slice("--bz-game-version=".length);
    }
  }

  return {
    gameId,
    version: version || "latest",
  };
}

function normalizeStorageInitResponse(payload: unknown): {
  data: Record<string, string>;
  encrypted: boolean;
} {
  if (!payload || typeof payload !== "object") {
    return { data: {}, encrypted: false };
  }
  const input = payload as {
    data?: Record<string, string>;
    encrypted?: boolean;
  };
  if (input.data && typeof input.data === "object") {
    return { data: input.data, encrypted: !!input.encrypted };
  }
  return { data: input as Record<string, string>, encrypted: false };
}

class GameStorage {
  private _data: Record<string, string> = Object.create(null);
  private _gameId: string;
  private _version: string;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _dirty = false;

  constructor(gameId: string, version: string) {
    this._gameId = gameId;
    this._version = version;
  }

  init(data: Record<string, string>) {
    this._data = Object.create(null);
    for (const [key, value] of Object.entries(data)) {
      Object.defineProperty(this._data, key, {
        value: typeof value === "string" ? value : String(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  get length(): number {
    return Object.keys(this._data).length;
  }

  clear(): void {
    this._data = Object.create(null);
    this._markDirty();
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? this._data[key]
      : null;
  }

  key(index: number): string | null {
    const keys = Object.keys(this._data);
    return keys[index] || null;
  }

  removeItem(key: string): void {
    delete this._data[key];
    this._markDirty();
  }

  setItem(key: string, value: string): void {
    Object.defineProperty(this._data, String(key), {
      value: String(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    this._markDirty();
  }

  getSnapshot(): Record<string, string> {
    return { ...this._data };
  }

  private _markDirty(): void {
    this._dirty = true;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;
    ipcRenderer.send(IPC.GAME_STORAGE_FLUSH, this._gameId, this._version, {
      ...this._data,
    });
  }
}

const { gameId, version } = resolveGameIdentity();

if (gameId) {
  console.log(
    `[GamePreload] Initializing storage for game: ${gameId} @ ${version}`,
  );

  try {
    const storage = new GameStorage(gameId, version);
    const response = ipcRenderer.sendSync(
      IPC.GAME_STORAGE_INIT,
      gameId,
      version,
    );
    const normalized = normalizeStorageInitResponse(response);
    storage.init(normalized.data);

    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });

    window.addEventListener("beforeunload", () => {
      ipcRenderer.sendSync(
        IPC.GAME_STORAGE_FLUSH,
        gameId,
        version,
        storage.getSnapshot(),
      );
    });

    console.log("[GamePreload] localStorage overridden successfully");
  } catch (e) {
    console.error("[GamePreload] Failed to override localStorage", e);
  }
} else {
  console.warn(
    "[GamePreload] No gameId found in URL, skipping storage override",
  );
}
