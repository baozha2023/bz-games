import { ipcRenderer } from "electron";

// 简单的 Storage 模拟实现
class GameStorage implements Storage {
  [name: string]: any;

  private _data: Record<string, string> = {};
  private _gameId: string;
  private _version: string;

  constructor(
    gameId: string,
    version: string,
    initialData: Record<string, string>,
  ) {
    this._gameId = gameId;
    this._version = version;
    this._data = initialData;
  }

  get length(): number {
    return Object.keys(this._data).length;
  }

  clear(): void {
    this._data = {};
    ipcRenderer.send("game:storage:clear", this._gameId, this._version);
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
    ipcRenderer.send("game:storage:remove", this._gameId, this._version, key);
  }

  setItem(key: string, value: string): void {
    const stringValue = String(value);
    this._data[key] = stringValue;
    ipcRenderer.send(
      "game:storage:save",
      this._gameId,
      this._version,
      key,
      stringValue,
    );
  }
}

// 初始化逻辑
function init() {
  let gameId = "";
  let version = "";

  try {
    const params = new URLSearchParams(window.location.search);
    gameId = params.get("gameId") || "";
    version = params.get("version") || "latest";
  } catch (e) {
    console.error("[GamePreload] Failed to parse URL params", e);
  }

  if (gameId) {
    console.log(
      `[GamePreload] Initializing storage for game: ${gameId} @ ${version}`,
    );

    try {
      // 同步获取初始数据
      const initialData = ipcRenderer.sendSync(
        "game:storage:init",
        gameId,
        version,
      );

      const storage = new GameStorage(gameId, version, initialData || {});

      // 覆盖 localStorage
      Object.defineProperty(window, "localStorage", {
        value: storage,
        configurable: true,
        writable: true,
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
}

// 执行初始化
init();
