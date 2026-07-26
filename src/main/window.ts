import { BrowserWindow, app, Menu, Tray, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { storeService } from "./services/storage/StoreService";
import { playSessionDatabaseService } from "./services/storage/database/PlaySessionDatabaseService";
import { IPC } from "../shared/ipc-channels";
import { FLOAT_BALL_DEFAULT_SIZE } from "../shared/AppConstants";
import { openExternalHttpUrl } from "./utils/externalUrl";

export let mainWindow: BrowserWindow | null = null;
export let floatBallWindow: BrowserWindow | null = null;
let floatBallSaveTimer: ReturnType<typeof setTimeout> | null = null;
let tray: Tray | null = null;
let isQuitting = false;

export function markAppQuitting(): void {
  isQuitting = true;
}

async function buildTrayMenu(): Promise<Menu> {
  const recentGames = await playSessionDatabaseService.getRecentGames(5).catch(() => []);
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "显示主窗口",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
  ];

  if (recentGames.length > 0) {
    template.push({ type: "separator" });
    template.push({
      label: "最近游玩",
      enabled: false,
    });
    for (const game of recentGames) {
      template.push({
        label: game.game_name,
        click: () => {
          import("./services/game/GameManager").then(({ gameManager }) => {
            gameManager.launch(game.game_id);
          });
        },
      });
    }
  }

  template.push(
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );

  return Menu.buildFromTemplate(template);
}

export function updateTrayMenu(): void {
  if (tray) {
    void buildTrayMenu().then((menu) => tray?.setContextMenu(menu));
  }
}

function ensureTray(): void {
  if (tray) {
    updateTrayMenu();
    return;
  }
  tray = new Tray(join(app.getAppPath(), "resources", "icon.png"));
  tray.setToolTip("BZ-Games");
  void buildTrayMenu().then((menu) => tray?.setContextMenu(menu));
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), "resources", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    const settings = storeService.getSettings();
    event.preventDefault();
    ensureTray();
    if (settings.closeBehavior === "exit") {
      isQuitting = true;
      app.quit();
    } else {
      mainWindow?.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalHttpUrl(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

let floatBallScreenListenerRegistered = false;

function saveFloatBallPositionThrottled() {
  if (floatBallSaveTimer) return;
  floatBallSaveTimer = setTimeout(() => {
    floatBallSaveTimer = null;
    if (floatBallWindow && !floatBallWindow.isDestroyed()) {
      const [x, y] = floatBallWindow.getPosition();
      storeService.saveSettings({ floatBallPosition: { x, y } });
    }
  }, 300);
}

function registerFloatBallScreenListener(): void {
  if (floatBallScreenListenerRegistered) return;
  floatBallScreenListenerRegistered = true;
  screen.on("display-metrics-changed", () => {
    if (!floatBallWindow || floatBallWindow.isDestroyed()) return;
    const [bx, by] = floatBallWindow.getPosition();
    const ballSize = FLOAT_BALL_DEFAULT_SIZE;
    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;
    const defaultX = workArea.x + workArea.width - ballSize - 20;
    const defaultY = workArea.y + workArea.height - ballSize - 80;
    if (!isFloatBallOnScreen(bx, by, ballSize)) {
      floatBallWindow.setPosition(defaultX, defaultY);
    }
  });
}

function isFloatBallOnScreen(x: number, y: number, ballSize: number): boolean {
  const half = ballSize / 2;
  const centerX = x + half;
  const centerY = y + half;
  for (const display of screen.getAllDisplays()) {
    const { workArea: wa } = display;
    if (
      centerX >= wa.x &&
      centerX <= wa.x + wa.width &&
      centerY >= wa.y &&
      centerY <= wa.y + wa.height
    ) {
      return true;
    }
  }
  return false;
}

function clampFloatBallToScreen(
  x: number,
  y: number,
  ballSize: number,
  defaultX: number,
  defaultY: number,
): { x: number; y: number } {
  if (isFloatBallOnScreen(x, y, ballSize)) {
    return { x, y };
  }
  return { x: defaultX, y: defaultY };
}

export function createFloatBallWindow(): void {
  if (floatBallWindow && !floatBallWindow.isDestroyed()) return;

  const settings = storeService.getSettings();
  const savedPos = settings.floatBallPosition;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const ballSize = FLOAT_BALL_DEFAULT_SIZE;

  const defaultX = workArea.x + workArea.width - ballSize - 20;
  const defaultY = workArea.y + workArea.height - ballSize - 80;

  const flooredX = savedPos?.x ?? defaultX;
  const flooredY = savedPos?.y ?? defaultY;

  const { x, y } = clampFloatBallToScreen(flooredX, flooredY, ballSize, defaultX, defaultY);

  floatBallWindow = new BrowserWindow({
    width: ballSize,
    height: ballSize,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  floatBallWindow.setAlwaysOnTop(true, "screen-saver");

  registerFloatBallScreenListener();

  floatBallWindow.on("moved", saveFloatBallPositionThrottled);

  floatBallWindow.on("will-move", () => {
    if (floatBallWindow && !floatBallWindow.isDestroyed()) {
      floatBallWindow.webContents.send(IPC.FLOAT_BALL_DRAG_STATE, true);
    }
  });

  let dragEndTimer: ReturnType<typeof setTimeout> | null = null;
  floatBallWindow.on("moved", () => {
    if (dragEndTimer) clearTimeout(dragEndTimer);
    dragEndTimer = setTimeout(() => {
      if (floatBallWindow && !floatBallWindow.isDestroyed()) {
        floatBallWindow.webContents.send(IPC.FLOAT_BALL_DRAG_STATE, false);
      }
    }, 150);
  });

  floatBallWindow.on("close", () => {
    if (floatBallSaveTimer) {
      clearTimeout(floatBallSaveTimer);
      floatBallSaveTimer = null;
    }
    if (floatBallWindow && !floatBallWindow.isDestroyed()) {
      const [x, y] = floatBallWindow.getPosition();
      storeService.saveSettings({ floatBallPosition: { x, y } });
    }
    floatBallWindow = null;
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    floatBallWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/#/float-ball`,
    );
  } else {
    floatBallWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      hash: "/float-ball",
    });
  }

  floatBallWindow.once("ready-to-show", () => {
    import("./services/market/MarketService").then(({ marketService }) => {
      const progress = marketService.computeTotalProgress();
      if (progress.activeTaskCount > 0) {
        floatBallWindow?.showInactive();
      }
    });
  });
}

export function destroyFloatBallWindow(): void {
  if (floatBallWindow && !floatBallWindow.isDestroyed()) {
    floatBallWindow.close();
  }
  floatBallWindow = null;
}
