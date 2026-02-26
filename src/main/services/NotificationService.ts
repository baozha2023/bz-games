import { BrowserWindow, screen } from "electron";
import path from "path";
import { is } from "@electron-toolkit/utils";
import { logger } from "../utils/logger";
import { storeService } from "./StoreService";

class NotificationService {
  private window: BrowserWindow | null = null;
  private closeTimeout: NodeJS.Timeout | null = null;
  private queue: Array<{
    title: string;
    description: string;
    gameName: string;
    icon?: string;
  }> = [];
  private isShowing = false;

  show(title: string, description: string, gameName: string, icon?: string) {
    this.queue.push({ title, description, gameName, icon });
    if (!this.isShowing) {
      this.showNext();
    }
  }

  private showNext() {
    if (this.queue.length === 0) {
      this.isShowing = false;
      return;
    }
    this.isShowing = true;
    const next = this.queue.shift();
    if (!next) {
      this.isShowing = false;
      return;
    }
    const { title, description, gameName, icon } = next;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;

    const width = 300;
    const height = 64;
    const margin = 0;

    const x = workArea.x + workArea.width - width - margin;
    const y = workArea.y + workArea.height - height - margin;

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false,
    });

    this.window.setIgnoreMouseEvents(false);

    const settings = storeService.getSettings();
    const theme = settings.theme || "dark";

    const params = new URLSearchParams({
      title,
      description,
      gameName,
      icon: icon || "",
      theme,
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.window.loadURL(
        `${process.env["ELECTRON_RENDERER_URL"]}/#/notification?${params.toString()}`,
      );
    } else {
      this.window.loadFile(path.join(__dirname, "../renderer/index.html"), {
        hash: `/notification?${params.toString()}`,
      });
    }

    this.window.once("ready-to-show", () => {
      this.window?.showInactive();
      logger.info("[NotificationService] Notification shown");
    });

    this.window.once("closed", () => {
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
      this.window = null;
      this.showNext();
    });

    this.closeTimeout = setTimeout(() => {
      if (this.window) this.window.close();
    }, 5000);
  }
}

export const notificationService = new NotificationService();
