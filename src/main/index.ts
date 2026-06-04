import { app, BrowserWindow, session } from "electron";
import { createWindow, markAppQuitting, mainWindow, createFloatBallWindow } from "./window";
import { registerAllIpc } from "./ipc";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { storeService } from "./services/StoreService";
import { marketService } from "./services/MarketService";
import { databaseService } from "./services/DatabaseService";
import { requestInterceptor } from "./services/MarketService";
import { roomDiscoveryService } from "./services/RoomDiscoveryService";

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId("com.bz.launcher");

    requestInterceptor.registerSessionHandler(session.defaultSession);

    await storeService.init();
    databaseService.init();
    const settings = storeService.getSettings();
    app.setLoginItemSettings({
      openAtLogin: settings.autoLaunch,
    });

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    registerAllIpc();
    roomDiscoveryService.start();
    createWindow();

    if (settings.downloadFloatBall) {
      createFloatBallWindow();
    }

    marketService.restorePendingTasks();

    app.on("activate", function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("before-quit", () => {
  storeService.recordAppClosed();
  roomDiscoveryService.stop();
  databaseService.close();
  markAppQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
