import { ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";

class GameStorage implements Storage {
  [name: string]: any;

  private _data: Record<string, string> = {};
  private _gameId: string;
  private _version: string;

  constructor(
    gameId: string,
    version: string,
    initialData: Record<string, string>,
    _encrypted: boolean,
  ) {
    this._gameId = gameId;
    this._version = version;
    this._data = Object.fromEntries(
      Object.entries(initialData).map(([key, value]) => [
        key,
        typeof value === "string" ? value : String(value),
      ]),
    );
  }

  get length(): number {
    return Object.keys(this._data).length;
  }

  clear(): void {
    this._data = {};
    ipcRenderer.send(IPC.GAME_STORAGE_CLEAR, this._gameId, this._version);
  }

  getItem(key: string): string | null {
    return this._data[key] || null;
  }

  key(index: number): string | null {
    const keys = Object.keys(this._data);
    return keys[index] || null;
  }

  removeItem(key: string): void {
    delete this._data[key];
    ipcRenderer.send(IPC.GAME_STORAGE_REMOVE, this._gameId, this._version, key);
  }

  setItem(key: string, value: string): void {
    const stringValue = String(value);
    this._data[key] = stringValue;
    ipcRenderer.send(
      IPC.GAME_STORAGE_SAVE,
      this._gameId,
      this._version,
      key,
      stringValue,
    );
  }
}

function init() {
  const { gameId, version } = resolveGameIdentity();

  if (gameId) {
    console.log(
      `[GamePreload] Initializing storage for game: ${gameId} @ ${version}`,
    );

    try {
      const response = ipcRenderer.sendSync(
        IPC.GAME_STORAGE_INIT,
        gameId,
        version,
      );
      const normalized = normalizeStorageInitResponse(response);

      const storage = new GameStorage(
        gameId,
        version,
        normalized.data,
        normalized.encrypted,
      );
      if (installStorageBridge(storage)) {
        console.log("[GamePreload] localStorage bridge installed");
      } else {
        console.error("[GamePreload] Failed to install localStorage bridge");
      }
    } catch (e) {
      console.error("[GamePreload] Failed to override localStorage", e);
    }
  } else {
    console.warn(
      "[GamePreload] No gameId found in URL, skipping storage override",
    );
  }
}

function resolveGameIdentity(): { gameId: string; version: string } {
  let gameId = "";
  let version = "";

  try {
    const params = new URLSearchParams(window.location.search);
    gameId = params.get("gameId") || "";
    version = params.get("version") || "";
  } catch (e) {
    console.error("[GamePreload] Failed to parse URL params", e);
  }

  if (!gameId || !version) {
    const argv = process.argv || [];
    for (const arg of argv) {
      if (!gameId && arg.startsWith("--bz-game-id=")) {
        gameId = arg.slice("--bz-game-id=".length);
      }
      if (!version && arg.startsWith("--bz-game-version=")) {
        version = arg.slice("--bz-game-version=".length);
      }
    }
  }

  return {
    gameId,
    version: version || "latest",
  };
}

function installStorageBridge(storage: GameStorage): boolean {
  try {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    if (window.localStorage === storage) {
      return true;
    }
  } catch {}

  try {
    const nativeStorage = window.localStorage;
    const proto = Object.getPrototypeOf(nativeStorage);
    Object.defineProperty(proto, "getItem", {
      value: (key: string) => storage.getItem(String(key)),
      configurable: true,
    });
    Object.defineProperty(proto, "setItem", {
      value: (key: string, value: string) =>
        storage.setItem(String(key), String(value)),
      configurable: true,
    });
    Object.defineProperty(proto, "removeItem", {
      value: (key: string) => storage.removeItem(String(key)),
      configurable: true,
    });
    Object.defineProperty(proto, "clear", {
      value: () => storage.clear(),
      configurable: true,
    });
    Object.defineProperty(proto, "key", {
      value: (index: number) => storage.key(Number(index)),
      configurable: true,
    });
    Object.defineProperty(proto, "length", {
      get: () => storage.length,
      configurable: true,
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeStorageInitResponse(
  payload: unknown,
): { data: Record<string, string>; encrypted: boolean } {
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

init();
