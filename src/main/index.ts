import { app, BrowserWindow, session } from "electron";
import { createWindow, markAppQuitting } from "./window";
import { registerAllIpc } from "./ipc";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { storeService } from "./services/StoreService";
import { marketService } from "./services/MarketService";
import { databaseService } from "./services/DatabaseService";
import { setCustomGamesDir } from "./utils/appPath";

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.bz.launcher");

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://cdn.bzgames.top/*"] },
    (details, callback) => {
      details.requestHeaders["Referer"] = "https://bz-game-client.local";
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  await storeService.init();
  databaseService.init();
  const settings = storeService.getSettings();
  setCustomGamesDir(settings.gameStoragePath || null);
  app.setLoginItemSettings({
    openAtLogin: settings.autoLaunch,
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerAllIpc();
  createWindow();

  marketService.restorePendingTasks();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  databaseService.close();
  markAppQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
