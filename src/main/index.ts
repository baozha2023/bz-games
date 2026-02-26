import { app, BrowserWindow } from "electron";
import { createWindow } from "./window";
import { registerAllIpc } from "./ipc";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { storeService } from "./services/StoreService";

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.bz.launcher");

  await storeService.init();

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerAllIpc();
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
