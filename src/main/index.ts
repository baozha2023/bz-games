import { app, BrowserWindow, session } from "electron";
import { spawnSync } from "child_process";
import path from "path";
import { createWindow, markAppQuitting, mainWindow, createFloatBallWindow } from "./window";
import { registerAllIpc } from "./ipc";
import { electronApp } from "@electron-toolkit/utils";
import { storeService } from "./services/storage/StoreService";
import { marketService } from "./services/market/MarketService";
import { playSessionDatabaseService } from "./services/storage/database/PlaySessionDatabaseService";
import { achievementUnlockDatabaseService } from "./services/storage/database/AchievementUnlockDatabaseService";
import { statsReportDatabaseService } from "./services/storage/database/StatsReportDatabaseService";
import { requestInterceptor } from "./utils/requestInterceptor";
import { roomDiscoveryService } from "./services/room/RoomDiscoveryService";
import { cloudSyncService } from "./services/system/CloudSyncService";
import { logger } from "./utils/logger";

logger.installGlobalHandlers();

const gotTheLock = app.requestSingleInstanceLock();
const PROTOCOL_SCHEME = "bzgames";
const pendingProtocolUrls: string[] = [];
let appReadyForProtocol = false;

function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function findProtocolUrl(argv: string[]): string {
  return argv.find((item) => item.startsWith(`${PROTOCOL_SCHEME}://`)) || "";
}

function registerProtocolClient(): void {
  if (process.defaultApp) {
    const mainScriptPath = path.join(__dirname, "index.js");
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [mainScriptPath]);
    if (process.platform === "win32") {
      const command = `${quoteWindowsArg(process.execPath)} ${quoteWindowsArg(mainScriptPath)} "%1"`;
      spawnSync("reg", ["add", `HKCU\\Software\\Classes\\${PROTOCOL_SCHEME}`, "/ve", "/d", "URL:BZ-Games Protocol", "/f"], { windowsHide: true });
      spawnSync("reg", ["add", `HKCU\\Software\\Classes\\${PROTOCOL_SCHEME}`, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"], { windowsHide: true });
      spawnSync("reg", ["add", `HKCU\\Software\\Classes\\${PROTOCOL_SCHEME}\\shell\\open\\command`, "/ve", "/d", command, "/f"], { windowsHide: true });
    }
    return;
  }
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.moveTop();
  mainWindow.focus();
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.focus();
  }, 300);
}

function handleProtocolUrl(url: string): void {
  if (!url) return;
  if (!appReadyForProtocol) {
    pendingProtocolUrls.push(url);
    return;
  }
  void cloudSyncService.completeOAuth(url).finally(showMainWindow);
}

function flushPendingProtocolUrls(): void {
  const urls = pendingProtocolUrls.splice(0);
  for (const url of urls) {
    handleProtocolUrl(url);
  }
}

registerProtocolClient();
const launchProtocolUrl = findProtocolUrl(process.argv);

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_, argv) => {
    const protocolUrl = findProtocolUrl(argv);
    handleProtocolUrl(protocolUrl);
    if (!protocolUrl) showMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId("com.bz.launcher");

    requestInterceptor.registerSessionHandler(session.defaultSession);

    await storeService.init();
    playSessionDatabaseService.init();
    achievementUnlockDatabaseService.init();
    statsReportDatabaseService.init();
    appReadyForProtocol = true;
    const settings = storeService.getSettings();
    app.setLoginItemSettings({
      openAtLogin: settings.autoLaunch,
    });

    app.on("browser-window-created", (_, window) => {
      // 开发模式保留 DevTools
      if (!app.isPackaged) return;

      window.webContents.on("before-input-event", (_event, input) => {
        // 禁止 F12 / Ctrl+Shift+I 打开 DevTools
        if (
          input.key === "F12" ||
          (input.control && input.shift && input.key.toLowerCase() === "i")
        ) {
          _event.preventDefault();
          return;
        }
        // F11 全屏切换
        if (input.key === "F11") {
          _event.preventDefault();
          window.setFullScreen(!window.isFullScreen());
        }
      });
      // 兜底：若 DevTools 以其他方式打开则立即关闭
      window.webContents.on("devtools-opened", () => {
        window.webContents.closeDevTools();
      });
    });

    registerAllIpc();
    roomDiscoveryService.start();
    createWindow();

    if (settings.downloadFloatBall) {
      createFloatBallWindow();
    }

    if (launchProtocolUrl) {
      handleProtocolUrl(launchProtocolUrl);
    }

    flushPendingProtocolUrls();

    marketService.restorePendingTasks();

    app.on("activate", function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("before-quit", () => {
  storeService.recordAppClosed();
  roomDiscoveryService.stop();
  void playSessionDatabaseService.close();
  void achievementUnlockDatabaseService.close();
  void statsReportDatabaseService.close();
  markAppQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
