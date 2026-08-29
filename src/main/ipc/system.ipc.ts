import {
  app,
  ipcMain,
  dialog,
  nativeImage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { getAppRoot } from "../utils/appPath";
import { storeService } from "../services/storage/StoreService";
import { logger } from "../utils/logger";
import type { AppSettings, NicknameStyle } from "../../shared/types";
import {
  createFloatBallWindow,
  destroyFloatBallWindow,
  mainWindow,
} from "../window";
import { accountService } from "../services/system/AccountService";
import { feedbackService } from "../services/system/FeedbackService";
import { forumService } from "../services/system/ForumService";
import { uninstallService } from "../services/system/UninstallService";
import { AVATAR_FRAMES } from "../../shared/avatar-frames";
import {
  getGameCardProduct,
  getGameCardProductAsset,
} from "../../shared/game-card-products";
import { openExternalHttpUrl } from "../utils/externalUrl";
import { marketService } from "../services/market/MarketService";

let sensitiveWordCache: string[] | null = null;
const ALLOWED_AVATAR_FRAME_FILES = new Set(
  AVATAR_FRAMES.map((frame) => frame.imageFileName),
);
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const MAX_SAVED_PNG_BYTES = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const RENDERER_WRITABLE_SETTING_KEYS = [
  "playerName",
  "avatar",
  "language",
  "theme",
  "defaultRoomPort",
  "closeBehavior",
  "autoLaunch",
  "downloadFloatBall",
  "sensitiveWordFilter",
  "githubToken",
  "libraryLayout",
  "lastJoinRoomAddress",
  "chatInputHeight",
] as const satisfies readonly (keyof AppSettings)[];

type RendererWritableSettingKey =
  (typeof RENDERER_WRITABLE_SETTING_KEYS)[number];
type RendererWritableSettings = Partial<
  Pick<AppSettings, RendererWritableSettingKey>
>;

/**
 * Renderer settings are untrusted. Only fields that have renderer-owned UI or
 * renderer runtime state may cross this IPC boundary. In particular,
 * Authentication and identity fields are main-process-owned.
 */
function selectRendererWritableSettings(
  settings: unknown,
): RendererWritableSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  const source = settings as Partial<AppSettings>;
  const selected: Record<string, unknown> = {};
  for (const key of RENDERER_WRITABLE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      selected[key] = source[key];
    }
  }
  return selected as RendererWritableSettings;
}

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) {
    throw new Error("system_ipc_sender_not_allowed");
  }
}

function getRendererVisibleSettings(): AppSettings {
  return {
    ...storeService.getSettings(),
    accountSessionToken: "",
    accountSessionExpiresAt: "",
  };
}

function decodePngDataUrl(dataUrl: unknown): Buffer {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error("invalid_png_data_url");
  }

  const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  const maxBase64Length = Math.ceil(MAX_SAVED_PNG_BYTES / 3) * 4;
  if (
    base64.length === 0 ||
    base64.length > maxBase64Length ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) {
    throw new Error("invalid_png_data");
  }

  const buffer = Buffer.from(base64, "base64");
  if (
    buffer.length === 0 ||
    buffer.length > MAX_SAVED_PNG_BYTES ||
    buffer.toString("base64") !== base64 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("invalid_png_data");
  }
  return buffer;
}

function sanitizePngDefaultName(value: unknown): string {
  if (typeof value !== "string") return "BZ-Games-Heatmap.png";
  const baseName = path
    .basename(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  if (!baseName) return "BZ-Games-Heatmap.png";
  return baseName.toLowerCase().endsWith(".png") ? baseName : `${baseName}.png`;
}

function loadSensitiveWords(): string[] {
  if (sensitiveWordCache) return sensitiveWordCache;
  const vocabularyDir = app.isPackaged
    ? path.join(app.getAppPath(), "resources", "vocabulary")
    : path.join(process.cwd(), "resources", "vocabulary");
  try {
    const words = fs
      .readdirSync(vocabularyDir)
      .filter((fileName) => fileName.endsWith(".txt"))
      .flatMap((fileName) => {
        const filePath = path.join(vocabularyDir, fileName);
        return fs
          .readFileSync(filePath, "utf8")
          .split(/\r?\n/)
          .map((word) => word.trim())
          .filter(Boolean);
      });
    sensitiveWordCache = Array.from(new Set(words)).sort(
      (a, b) => b.length - a.length,
    );
  } catch (error) {
    logger.error("[SystemIPC] Failed to load sensitive vocabulary:", error);
    sensitiveWordCache = [];
  }
  return sensitiveWordCache;
}

export function registerSystemIpc() {
  function applyAutoLaunchSetting(
    settings: AppSettings | Partial<AppSettings>,
  ) {
    if (typeof settings.autoLaunch !== "boolean") return;
    app.setLoginItemSettings({
      openAtLogin: settings.autoLaunch,
      ...(app.isPackaged
        ? { path: path.join(getAppRoot(), "BZ-Games.exe"), args: [] }
        : {}),
    });
  }
  function applyFloatBallSetting(settings: AppSettings | Partial<AppSettings>) {
    if (!("downloadFloatBall" in settings)) return;
    if (settings.downloadFloatBall) {
      createFloatBallWindow();
    } else {
      destroyFloatBallWindow();
    }
  }

  ipcMain.handle(IPC.SYSTEM_GET_SETTINGS, async () => {
    return getRendererVisibleSettings();
  });

  ipcMain.handle(IPC.SYSTEM_GET_APP_VERSION, async () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC.SYSTEM_GET_SENSITIVE_WORDS, async () => {
    return loadSensitiveWords();
  });

  ipcMain.handle(IPC.SYSTEM_ACCOUNT_GET_LOCAL_STATUS, (event) => {
    assertMainWindowSender(event);
    return accountService.getLocalStatus();
  });

  ipcMain.handle(IPC.SYSTEM_ACCOUNT_GET_PRESENCE_STATUS, (event) => {
    assertMainWindowSender(event);
    return accountService.getPresenceStatus();
  });

  ipcMain.handle(
    IPC.SYSTEM_ACCOUNT_SET_PRESENCE,
    async (event, enabled: unknown) => {
      assertMainWindowSender(event);
      return accountService.setPresenceEnabled(enabled === true);
    },
  );

  ipcMain.handle(IPC.SYSTEM_ACCOUNT_LOGIN_GITHUB, async (event) => {
    assertMainWindowSender(event);
    return await accountService.loginWithGitHub();
  });

  ipcMain.handle(IPC.SYSTEM_ACCOUNT_LOGOUT, async (event) => {
    assertMainWindowSender(event);
    return await accountService.logout();
  });

  ipcMain.handle(IPC.SYSTEM_FEEDBACK_SELECT_IMAGES, (_, selectionId: unknown) =>
    feedbackService.selectImages(selectionId),
  );

  ipcMain.handle(
    IPC.SYSTEM_FEEDBACK_RELEASE_IMAGES,
    (_, selectionId: unknown, imageId?: unknown) => {
      feedbackService.releaseImages(selectionId, imageId);
    },
  );

  ipcMain.handle(IPC.SYSTEM_FEEDBACK_SUBMIT, (_, payload: unknown) =>
    feedbackService.submit(payload),
  );

  ipcMain.handle(IPC.SYSTEM_FEEDBACK_GET_HISTORY, (_, cursor?: unknown) =>
    feedbackService.getHistory(typeof cursor === "string" ? cursor : ""),
  );

  ipcMain.handle(IPC.SYSTEM_FEEDBACK_GET_DETAIL, (_, feedbackId: unknown) =>
    feedbackService.getDetail(feedbackId),
  );

  ipcMain.handle(IPC.FORUM_SELECT_IMAGES, (_, selectionId: unknown) =>
    forumService.selectImages(selectionId),
  );
  ipcMain.handle(
    IPC.FORUM_RELEASE_IMAGES,
    (_, selectionId: unknown, imageId?: unknown) => {
      forumService.releaseImages(selectionId, imageId);
    },
  );
  ipcMain.handle(IPC.FORUM_GET_SEARCH_AVAILABILITY, () =>
    forumService.getSearchAvailability(),
  );
  ipcMain.handle(IPC.FORUM_LIST_POSTS, (_, query?: unknown, cursor?: unknown) =>
    forumService.listPosts(
      typeof query === "string" ? query : "",
      typeof cursor === "string" ? cursor : "",
    ),
  );
  ipcMain.handle(IPC.FORUM_GET_POST, (_, postId: unknown) =>
    forumService.getPost(typeof postId === "string" ? postId : ""),
  );
  ipcMain.handle(IPC.FORUM_RESOLVE_POST_REFERENCES, (_, ids: unknown) =>
    forumService.resolvePostReferences(
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string")
        : [],
    ),
  );
  ipcMain.handle(
    IPC.FORUM_GET_COMMENTS,
    (_, postId: unknown, cursor?: unknown) =>
      forumService.getComments(
        typeof postId === "string" ? postId : "",
        typeof cursor === "string" ? cursor : "",
      ),
  );
  ipcMain.handle(IPC.FORUM_CREATE_POST, (_, payload: unknown) => {
    const value =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    return forumService.createPost({
      title: typeof value.title === "string" ? value.title : "",
      body: typeof value.body === "string" ? value.body : "",
      selectionId:
        typeof value.selectionId === "string" ? value.selectionId : undefined,
    });
  });
  ipcMain.handle(
    IPC.FORUM_CREATE_COMMENT,
    (_, postId: unknown, content: unknown) =>
      forumService.createComment(
        typeof postId === "string" ? postId : "",
        typeof content === "string" ? content : "",
      ),
  );
  ipcMain.handle(IPC.FORUM_DELETE_POST, (_, postId: unknown) =>
    forumService.deletePost(typeof postId === "string" ? postId : ""),
  );
  ipcMain.handle(IPC.FORUM_DELETE_COMMENT, (_, commentId: unknown) =>
    forumService.deleteComment(typeof commentId === "string" ? commentId : ""),
  );
  ipcMain.handle(IPC.FORUM_LIKE_POST, (_, postId: unknown) =>
    forumService.togglePostLike(typeof postId === "string" ? postId : "", true),
  );
  ipcMain.handle(IPC.FORUM_UNLIKE_POST, (_, postId: unknown) =>
    forumService.togglePostLike(
      typeof postId === "string" ? postId : "",
      false,
    ),
  );
  ipcMain.handle(IPC.FORUM_LIKE_COMMENT, (_, commentId: unknown) =>
    forumService.toggleCommentLike(
      typeof commentId === "string" ? commentId : "",
      true,
    ),
  );
  ipcMain.handle(IPC.FORUM_UNLIKE_COMMENT, (_, commentId: unknown) =>
    forumService.toggleCommentLike(
      typeof commentId === "string" ? commentId : "",
      false,
    ),
  );

  ipcMain.handle(IPC.SYSTEM_SAVE_SETTINGS, async (_, settings: unknown) => {
    logger.info("[SystemIPC] Saving settings");
    try {
      const safeSettings = selectRendererWritableSettings(settings);
      const previousPlayerName = storeService.getSettings().playerName;
      storeService.saveSettings(safeSettings);
      if (
        typeof safeSettings.playerName === "string" &&
        safeSettings.playerName !== previousPlayerName
      ) {
        void accountService.syncPlayerName(safeSettings.playerName);
      }
      applyAutoLaunchSetting(safeSettings);
      applyFloatBallSetting(safeSettings);
      return true;
    } catch (error) {
      logger.error("[SystemIPC] Failed to save settings:", error);
      throw error;
    }
  });

  ipcMain.handle(
    IPC.SYSTEM_SAVE_PARTIAL_SETTINGS,
    async (_, partial: unknown) => {
      const safeSettings = selectRendererWritableSettings(partial);
      const previousPlayerName = storeService.getSettings().playerName;
      storeService.saveSettings(safeSettings);
      applyAutoLaunchSetting(safeSettings);
      if (
        typeof safeSettings.playerName === "string" &&
        safeSettings.playerName !== previousPlayerName
      ) {
        void accountService.syncPlayerName(safeSettings.playerName);
      }
      applyFloatBallSetting(safeSettings);
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_SAVE_NICKNAME_STYLE,
    async (_, style: NicknameStyle) => {
      return storeService.performSaveNicknameStyle(style, 30);
    },
  );

  ipcMain.handle(IPC.SYSTEM_UPLOAD_AVATAR, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "png", "jpeg", "webp"] }],
    });

    if (canceled || filePaths.length === 0) {
      return null;
    }

    const sourcePath = filePaths[0];

    try {
      const buffer = fs.readFileSync(sourcePath);
      const image = nativeImage.createFromBuffer(buffer);

      if (image.isEmpty()) {
        logger.error("[SystemIPC] Failed to load image from path:", sourcePath);
        return null;
      }

      const ext = path.extname(sourcePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".webp": "image/webp",
      };
      const mimeType = mimeMap[ext] || "image/jpeg";
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      logger.info("[SystemIPC] Avatar raw loaded, length:", dataUrl.length);
      return dataUrl;
    } catch (e) {
      logger.error("[SystemIPC] Failed to process avatar file:", e);
      return null;
    }
  });

  ipcMain.handle(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Select Game Storage Directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    const selectedPath = filePaths[0];
    const entries = fs.readdirSync(selectedPath);
    if (entries.length > 0) {
      return { path: selectedPath, error: "directory_not_empty" };
    }
    return { path: selectedPath };
  });

  ipcMain.handle(IPC.SYSTEM_GET_GAME_STORAGE_PATHS, async () => {
    return storeService.getGameStoragePathItems();
  });

  ipcMain.handle(
    IPC.SYSTEM_ADD_GAME_STORAGE_PATH,
    async (_, targetPath: string) => {
      return storeService.addGameStoragePath(targetPath);
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_SET_DEFAULT_GAME_STORAGE_PATH,
    async (_, targetPath: string) => {
      return storeService.setDefaultGameStoragePath(targetPath);
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_MIGRATE_GAME_STORAGE_LIBRARY,
    async (_, payload?: { sourcePath?: string; targetPath?: string }) => {
      try {
        if (!payload?.sourcePath || !payload?.targetPath) {
          return { success: false, error: "migration_path_required" };
        }

        const result = await storeService.migrateGameStorageLibrary(
          payload.sourcePath,
          payload.targetPath,
        );
        return { success: true, ...result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.SYSTEM_OPEN_PATH, async (_, targetPath: string) => {
    if (!targetPath || typeof targetPath !== "string") {
      return false;
    }
    const result = await shell.openPath(targetPath);
    return result === "";
  });

  ipcMain.handle(IPC.SYSTEM_OPEN_URL, async (_, value: unknown) => {
    return openExternalHttpUrl(value);
  });

  ipcMain.handle(
    IPC.SYSTEM_REMOVE_GAME_STORAGE_PATH,
    async (_, targetPath: string) => {
      try {
        const result = await storeService.removeGameStoragePath(targetPath);
        return { success: true, ...result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.SYSTEM_GET_USER_DATA, async () => {
    return storeService.getUserData();
  });

  ipcMain.handle(IPC.SYSTEM_UNLOCK_FRAME, async (_, frameId: unknown) => {
    return storeService.performUnlockFrame(
      typeof frameId === "string" ? frameId : "",
    );
  });

  ipcMain.handle(IPC.SYSTEM_EQUIP_FRAME, async (_, frameId: string) => {
    storeService.performEquipFrame(frameId);
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_UNEQUIP_FRAME, async (_, frameId: string) => {
    storeService.performUnequipFrame(frameId);
    return true;
  });

  ipcMain.handle(
    IPC.SYSTEM_UNLOCK_GAME_CARD_PRODUCT,
    async (_, productId: unknown) => {
      return storeService.performUnlockGameCardProduct(
        typeof productId === "string" ? productId : "",
      );
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_GET_GAME_CARD_PRODUCT_PROGRESS,
    async (_, productId: unknown) =>
      storeService.getGameCardProductUnlockProgress(
        typeof productId === "string" ? productId : "",
      ),
  );

  ipcMain.handle(
    IPC.SYSTEM_EQUIP_GAME_CARD_PRODUCT,
    async (_, productId: string) => {
      storeService.performEquipGameCardProduct(productId);
      return true;
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_UNEQUIP_GAME_CARD_PRODUCT,
    async (_, productId: string) => {
      storeService.performUnequipGameCardProduct(productId);
      return true;
    },
  );

  ipcMain.handle(IPC.SYSTEM_CHECK_IN, async () => {
    return storeService.performCheckIn();
  });

  ipcMain.handle(
    IPC.SYSTEM_GET_AVATAR_FRAME_IMAGE,
    async (_, fileName: unknown) => {
      try {
        if (
          typeof fileName !== "string" ||
          !ALLOWED_AVATAR_FRAME_FILES.has(fileName)
        ) {
          logger.warn("[SystemIPC] Rejected invalid avatar frame file name");
          return null;
        }
        const framePath = path.join(
          app.getAppPath(),
          "resources",
          "avatar-frames",
          fileName,
        );
        if (!fs.existsSync(framePath)) {
          logger.warn(`[SystemIPC] Avatar frame image not found: ${framePath}`);
          return null;
        }
        const buffer = fs.readFileSync(framePath);
        const ext = path.extname(fileName).toLowerCase();
        const mimeType =
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : "image/png";
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        return dataUrl;
      } catch (e) {
        logger.error("[SystemIPC] Failed to load avatar frame image:", e);
        return null;
      }
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_GET_GAME_CARD_PRODUCT_IMAGE,
    async (_, productId: unknown, ratio: unknown) => {
      try {
        if (
          typeof productId !== "string" ||
          (ratio !== "square" && ratio !== "wide")
        ) {
          logger.warn("[SystemIPC] Rejected invalid game card product asset");
          return null;
        }
        const product = getGameCardProduct(productId);
        const asset = getGameCardProductAsset(productId, ratio);
        if (!product || !asset) return null;
        const assetPath = path.join(
          app.getAppPath(),
          "resources",
          "game-card-products",
          product.id,
          asset.fileName,
        );
        if (!fs.existsSync(assetPath)) {
          logger.warn(
            `[SystemIPC] Game card product image not found: ${assetPath}`,
          );
          return null;
        }
        const buffer = fs.readFileSync(assetPath);
        return `data:image/png;base64,${buffer.toString("base64")}`;
      } catch (error) {
        logger.error(
          "[SystemIPC] Failed to load game card product image:",
          error,
        );
        return null;
      }
    },
  );

  ipcMain.handle(IPC.SYSTEM_DATA_HEALTH_CHECK, async () => {
    return await storeService.healthCheck();
  });

  ipcMain.handle(
    IPC.SYSTEM_UNINSTALL,
    async (
      event,
      payload?: { deleteGames?: boolean; deleteUserData?: boolean },
    ) => {
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender.id !== mainWindow.webContents.id
      ) {
        throw new Error("uninstall_ipc_sender_not_allowed");
      }
      return uninstallService.uninstall({
        deleteGames: payload?.deleteGames === true,
        deleteUserData: payload?.deleteUserData === true,
      });
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_SAVE_PNG,
    async (_, dataUrl: unknown, defaultName: unknown) => {
      try {
        const png = decodePngDataUrl(dataUrl);
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: "Save Image",
          defaultPath: sanitizePngDefaultName(defaultName),
          filters: [{ name: "PNG Image", extensions: ["png"] }],
        });
        if (canceled || !filePath) {
          return { success: false, canceled: true };
        }
        await fs.promises.writeFile(filePath, png);
        return { success: true, filePath };
      } catch (error) {
        logger.error("[SystemIPC] Failed to save PNG:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.SYSTEM_CLEAR_CACHE, async () => {
    const marketCachePath = path.join(app.getPath("userData"), ".market-cache");

    let totalSize = 0;
    let clearedSize = 0;

    function calcDirSize(dirPath: string): number {
      let size = 0;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          try {
            if (entry.isDirectory()) {
              size += calcDirSize(fullPath);
            } else {
              size += fs.statSync(fullPath).size;
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
      return size;
    }

    const httpCacheSize = await session.defaultSession
      .getCacheSize()
      .catch(() => 0);
    totalSize += httpCacheSize;
    try {
      await session.defaultSession.clearCache();
      clearedSize += httpCacheSize;
    } catch (error) {
      logger.warn(
        "[SystemIPC] Failed to clear current Electron HTTP cache",
        error,
      );
    }

    if (!marketService.hasRetainedTasks() && fs.existsSync(marketCachePath)) {
      totalSize += calcDirSize(marketCachePath);
      try {
        const entries = fs.readdirSync(marketCachePath, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          const fullPath = path.join(marketCachePath, entry.name);
          try {
            const entrySize = entry.isDirectory()
              ? calcDirSize(fullPath)
              : fs.statSync(fullPath).size;
            fs.rmSync(fullPath, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 200,
            });
            clearedSize += entrySize;
          } catch {
            logger.warn(`[SystemIPC] Cache clear skipped: ${fullPath}`);
          }
        }
      } catch {
        logger.warn(
          `[SystemIPC] Cache clear failed to read: ${marketCachePath}`,
        );
      }
    }

    marketService.clearMemoryCaches();

    return { totalSize, clearedSize };
  });
}
