import { app, BrowserWindow } from "electron";
import { createWindow, markAppQuitting } from "./window";
import { registerAllIpc } from "./ipc";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { storeService } from "./services/StoreService";
import { setCustomGamesDir } from "./utils/appPath";

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.bz.launcher");

  await storeService.init();
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

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  markAppQuitting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
