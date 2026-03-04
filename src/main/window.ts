import { BrowserWindow, shell, app, Menu, Tray } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { storeService } from "./services/StoreService";

export let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

export function markAppQuitting(): void {
  isQuitting = true;
}

function ensureTray(): void {
  if (tray) return;
  tray = new Tray(join(app.getAppPath(), "resources", "icon.png"));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("BZ-Games");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
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
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
