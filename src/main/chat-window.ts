import { BrowserWindow, app } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC } from "../shared/ipc-channels";
import { mainWindow } from "./window";
import { storeService } from "./services/StoreService";
import type { ChatPayload } from "../shared/types";

export let chatWindow: BrowserWindow | null = null;
let cachedChatHistory: ChatPayload[] = [];
let boundsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function saveBoundsThrottled() {
  if (boundsDebounceTimer) return;
  boundsDebounceTimer = setTimeout(() => {
    boundsDebounceTimer = null;
    if (chatWindow && !chatWindow.isDestroyed()) {
      const bounds = chatWindow.getBounds();
      storeService.saveSettings({
        chatWindowBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      });
    }
  }, 300);
}

export function getCachedChatHistory(): ChatPayload[] {
  return cachedChatHistory;
}

export function createChatWindow(chatHistory: ChatPayload[]): void {
  cachedChatHistory = chatHistory;
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }

  const settings = storeService.getSettings();
  const savedBounds = settings.chatWindowBounds;

  chatWindow = new BrowserWindow({
    x: savedBounds?.x,
    y: savedBounds?.y,
    width: savedBounds?.width ?? 429,
    height: savedBounds?.height ?? 780,
    minWidth: 300,
    minHeight: 300,
    resizable: true,
    autoHideMenuBar: true,
    title: "BZ-Games Chat",
    show: false,
    icon: join(app.getAppPath(), "resources", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  chatWindow.on("ready-to-show", () => {
    chatWindow?.show();
    if (chatWindow) {
      chatWindow.webContents.send(IPC.ROOM_EVENT, {
        type: "room:chat:history:sync",
        payload: chatHistory,
      });
    }
  });

  chatWindow.on("close", () => {
    if (boundsDebounceTimer) {
      clearTimeout(boundsDebounceTimer);
      boundsDebounceTimer = null;
    }
    if (chatWindow && !chatWindow.isDestroyed()) {
      const bounds = chatWindow.getBounds();
      storeService.saveSettings({
        chatWindowBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      });
    }
    chatWindow = null;
    mainWindow?.webContents.send(IPC.ROOM_CHAT_WINDOW_CLOSED);
  });

  chatWindow.on("moved", saveBoundsThrottled);

  chatWindow.on("resized", saveBoundsThrottled);

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    chatWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/#/chat-popout`);
  } else {
    chatWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      hash: "/chat-popout",
    });
  }
}

export function closeChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
    chatWindow = null;
  }
}

export function sendRoomEventToChat(event: unknown): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send(IPC.ROOM_EVENT, event);
  }
}
