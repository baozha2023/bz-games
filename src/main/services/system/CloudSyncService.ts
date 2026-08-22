import crypto from "crypto";
import {
  DEFAULT_RELAY_SERVER_URL,
  OAUTH_RETURN_URL,
} from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { storeService } from "../storage/StoreService";
import {
  exportCloudSqlDump,
  importCloudSqlDump,
} from "../storage/database/BzGamesDatabase";
import { openExternalHttpUrl } from "../../utils/externalUrl";
import { logger } from "../../utils/logger";
import { mainWindow } from "../../window";
import { IPC } from "../../../shared/ipc-channels";
import type {
  CloudAuthChangedPayload,
  CloudAuthChangedReason,
  CloudPresenceStatus,
  CloudSnapshotMetaResult,
  CloudSyncResult,
  LocalCloudStatus,
  PlatformCloudSnapshotMeta,
} from "../../../shared/types";

export type CloudSyncProgressStage =
  | "checking"
  | "uploading"
  | "downloading"
  | "applying"
  | "completed";

export interface PlatformCloudSnapshot {
  formatVersion: 1;
  createdAt: string;
  config: string;
  databaseSql: string;
}

export interface CloudSyncProgress {
  stage: CloudSyncProgressStage;
  percentage: number;
}

type CloudSyncProgressHandler = (progress: CloudSyncProgress) => void;

const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
const PRESENCE_REQUEST_TIMEOUT_MS = 10_000;

function normalizeRelayHttpBase(): string {
  const relayUrl = DEFAULT_RELAY_SERVER_URL.trim();
  if (!relayUrl) return "";
  if (relayUrl.startsWith("wss://")) {
    return `https://${relayUrl.slice("wss://".length)}`.replace(/\/+$/, "");
  }
  if (relayUrl.startsWith("ws://")) {
    return `http://${relayUrl.slice("ws://".length)}`.replace(/\/+$/, "");
  }
  return relayUrl.replace(/\/+$/, "");
}

function getCloudHeaders(
  url: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = storeService.getSettings().cloudSessionToken || "";
  return requestInterceptor.buildHeaders(
    url,
    token ? { ...extra, Authorization: `Bearer ${token}` } : extra,
  );
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseSnapshot(buffer: Buffer): PlatformCloudSnapshot {
  const parsed = JSON.parse(
    buffer.toString("utf8"),
  ) as Partial<PlatformCloudSnapshot>;
  if (
    parsed.formatVersion !== 1 ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.config !== "string" ||
    typeof parsed.databaseSql !== "string"
  ) {
    throw new Error("cloud_snapshot_invalid");
  }
  return parsed as PlatformCloudSnapshot;
}

export class CloudSyncService {
  private readonly baseUrl = normalizeRelayHttpBase();
  private activeOperation: Promise<CloudSyncResult> | null = null;
  private presenceEnabled = false;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceRequest: Promise<boolean> | null = null;
  private shuttingDown = false;

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async loginWithGitHub(): Promise<{ success: boolean; error?: string }> {
    if (this.shuttingDown)
      return { success: false, error: "app_shutting_down" };
    if (!this.baseUrl) return { success: false, error: "cloud_not_configured" };
    const returnTo = OAUTH_RETURN_URL || "bzgames://oauth-complete";
    const url = new URL(`${this.baseUrl}/auth/github/start`);
    url.searchParams.set("returnTo", returnTo);
    if (!(await openExternalHttpUrl(url.toString()))) {
      throw new Error("invalid_oauth_url");
    }
    return { success: true };
  }

  async completeOAuth(urlText: string): Promise<boolean> {
    if (this.shuttingDown) return false;
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      return false;
    }
    if (url.protocol !== "bzgames:" || url.hostname !== "oauth-complete") {
      return false;
    }
    const params = new URLSearchParams(
      url.hash.startsWith("#") ? url.hash.slice(1) : url.search.slice(1),
    );
    const token = params.get("session_token") || "";
    if (!token) return false;
    await storeService.init();
    storeService.saveSettings({
      cloudSessionToken: token,
      cloudSessionExpiresAt: params.get("expires_at") || "",
      cloudUserLogin: params.get("login") || "",
      cloudUserName: params.get("name") || "",
      cloudUserProfileUrl: params.get("profile_url") || "",
    });
    void this.syncPlayerName(storeService.getSettings().playerName);
    this.emitAuthChanged("login");
    return true;
  }

  getPresenceStatus(): CloudPresenceStatus {
    return { enabled: this.presenceEnabled };
  }

  async setPresenceEnabled(enabled: boolean): Promise<CloudPresenceStatus> {
    if (!enabled) {
      this.stopPresenceHeartbeat();
      this.presenceEnabled = false;
      await this.sendPresence(false);
      this.emitPresenceChanged();
      return this.getPresenceStatus();
    }

    if (
      this.shuttingDown ||
      !this.baseUrl ||
      !storeService.getSettings().cloudSessionToken
    ) {
      return this.getPresenceStatus();
    }

    const success = await this.sendPresence(true);
    if (!success || this.shuttingDown) {
      this.stopPresenceHeartbeat();
      this.presenceEnabled = false;
      this.emitPresenceChanged();
      return this.getPresenceStatus();
    }

    this.presenceEnabled = true;
    this.schedulePresenceHeartbeat();
    this.emitPresenceChanged();
    return this.getPresenceStatus();
  }

  async resetPresenceOnStartup(): Promise<void> {
    this.stopPresenceHeartbeat();
    this.presenceEnabled = false;
    if (!this.baseUrl || !storeService.getSettings().cloudSessionToken) return;
    await this.sendPresence(false);
  }

  async syncPlayerName(playerName: string): Promise<void> {
    if (!this.baseUrl || !storeService.getSettings().cloudSessionToken) return;

    const url = `${this.baseUrl}/api/v1/me/profile`;
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: getCloudHeaders(url, {
          "Content-Type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({ nickname: playerName }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (response.ok) return;

      this.handleAuthFailure(body.error);
      logger.warn(
        `[CloudSyncService] Failed to sync playerName (${response.status}):`,
        body.error || "unknown_error",
      );
    } catch (error) {
      logger.warn("[CloudSyncService] Failed to sync playerName:", error);
    }
  }

  getLocalStatus(): LocalCloudStatus {
    const settings = storeService.getSettings();
    const authenticated = Boolean(settings.cloudSessionToken);
    return {
      configured: this.isConfigured(),
      authenticated,
      userLogin: authenticated ? settings.cloudUserLogin || "" : "",
      userName: authenticated ? settings.cloudUserName || "" : "",
      userProfileUrl: authenticated ? settings.cloudUserProfileUrl || "" : "",
      lastUploadedAt: settings.cloudLastUploadedAt || "",
    };
  }

  async getSnapshotMeta(): Promise<CloudSnapshotMetaResult> {
    if (!this.baseUrl) {
      return { success: false, snapshot: null, error: "cloud_not_configured" };
    }
    if (!storeService.getSettings().cloudSessionToken) {
      return { success: false, snapshot: null, error: "unauthorized" };
    }
    const metaUrl = `${this.baseUrl}/api/cloud/platform-snapshot/meta`;
    const response = await fetch(metaUrl, {
      headers: getCloudHeaders(metaUrl),
    });
    const body = (await response.json().catch(() => ({}))) as {
      snapshot?: PlatformCloudSnapshotMeta;
      error?: string;
      message?: string;
    };
    if (response.status === 404 && body.error === "snapshot_not_found") {
      return { success: true, snapshot: null };
    }
    if (!response.ok) {
      this.handleAuthFailure(body.error);
      return {
        success: false,
        snapshot: null,
        error: body.error || `snapshot_meta_failed_${response.status}`,
        message: body.message,
      };
    }
    const snapshot = body.snapshot || null;
    if (snapshot?.updatedAt) {
      storeService.saveSettings({
        cloudLastUploadedAt: new Date(snapshot.updatedAt).toISOString(),
      });
    }
    return { success: true, snapshot };
  }

  upload(progress?: CloudSyncProgressHandler): Promise<CloudSyncResult> {
    return this.runExclusive(() => this.performUpload(progress));
  }

  download(progress?: CloudSyncProgressHandler): Promise<CloudSyncResult> {
    return this.runExclusive(() => this.performDownload(progress));
  }

  async shutdown(): Promise<void> {
    this.stopPresenceHeartbeat();
    this.presenceEnabled = false;
    if (this.baseUrl && storeService.getSettings().cloudSessionToken) {
      await this.sendPresence(false);
    }
    this.shuttingDown = true;
    await this.activeOperation;
  }

  private schedulePresenceHeartbeat(): void {
    this.stopPresenceHeartbeat();
    this.presenceTimer = setTimeout(() => {
      void this.runPresenceHeartbeat();
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  }

  private stopPresenceHeartbeat(): void {
    if (!this.presenceTimer) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
  }

  private async runPresenceHeartbeat(): Promise<void> {
    this.presenceTimer = null;
    if (!this.presenceEnabled || this.shuttingDown) return;
    await this.sendPresence(true);
    if (this.presenceEnabled && !this.shuttingDown) {
      this.schedulePresenceHeartbeat();
    }
  }

  private async sendPresence(online: boolean): Promise<boolean> {
    if (!this.baseUrl || !storeService.getSettings().cloudSessionToken) {
      return false;
    }
    if (this.presenceRequest) await this.presenceRequest;

    const request = this.performPresenceRequest(online);
    this.presenceRequest = request;
    try {
      return await request;
    } finally {
      if (this.presenceRequest === request) this.presenceRequest = null;
    }
  }

  private async performPresenceRequest(online: boolean): Promise<boolean> {
    const url = `${this.baseUrl}/api/v1/me/presence`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PRESENCE_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: getCloudHeaders(url, {
          "Content-Type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({ online }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (response.ok) return true;
      this.handleAuthFailure(body.error);
      logger.warn(
        `[CloudSyncService] Failed to update presence (${response.status}):`,
        body.error || "unknown_error",
      );
      return false;
    } catch (error) {
      logger.warn("[CloudSyncService] Failed to update presence:", error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async performUpload(
    progress?: CloudSyncProgressHandler,
  ): Promise<CloudSyncResult> {
    if (!this.baseUrl) return { success: false, error: "cloud_not_configured" };
    if (!storeService.getSettings().cloudSessionToken) {
      return { success: false, error: "unauthorized" };
    }
    progress?.({ stage: "checking", percentage: 5 });
    const databaseSql = await exportCloudSqlDump();
    const snapshot: PlatformCloudSnapshot = {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      config: storeService.createCloudConfigContent(),
      databaseSql,
    };
    const body = Buffer.from(JSON.stringify(snapshot), "utf8");
    const url = `${this.baseUrl}/api/cloud/platform-snapshot`;
    progress?.({ stage: "uploading", percentage: 50 });
    const response = await fetch(url, {
      method: "PUT",
      headers: getCloudHeaders(url, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(body.length),
      }),
      body,
    });
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      this.handleAuthFailure(errorBody.error);
      return {
        success: false,
        error: errorBody.error || `upload_failed_${response.status}`,
        message: errorBody.message,
      };
    }
    const responseBody = (await response.json()) as {
      snapshot?: PlatformCloudSnapshotMeta;
    };
    const lastUploadedAt =
      responseBody.snapshot?.updatedAt || snapshot.createdAt;
    storeService.saveSettings({ cloudLastUploadedAt: lastUploadedAt });
    progress?.({ stage: "completed", percentage: 100 });
    return { success: true, lastUploadedAt };
  }

  private async performDownload(
    progress?: CloudSyncProgressHandler,
  ): Promise<CloudSyncResult> {
    if (!this.baseUrl) return { success: false, error: "cloud_not_configured" };
    if (!storeService.getSettings().cloudSessionToken) {
      return { success: false, error: "unauthorized" };
    }
    progress?.({ stage: "checking", percentage: 5 });
    const url = `${this.baseUrl}/api/cloud/platform-snapshot`;
    const response = await fetch(url, { headers: getCloudHeaders(url) });
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      this.handleAuthFailure(errorBody.error);
      return {
        success: false,
        error: errorBody.error || `download_failed_${response.status}`,
        message: errorBody.message,
      };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    progress?.({ stage: "downloading", percentage: 75 });
    const expectedHash = response.headers.get("x-file-sha256") || "";
    if (!expectedHash || sha256(buffer) !== expectedHash) {
      return { success: false, error: "cloud_hash_mismatch" };
    }

    let snapshot: PlatformCloudSnapshot;
    let cloudConfig: ReturnType<typeof storeService.parseCloudConfigContent>;
    try {
      snapshot = parseSnapshot(buffer);
      cloudConfig = storeService.parseCloudConfigContent(snapshot.config);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "cloud_snapshot_invalid",
      };
    }

    progress?.({ stage: "applying", percentage: 90 });
    await importCloudSqlDump(snapshot.databaseSql);
    await storeService.refreshGameDerivedData();
    storeService.applyCloudConfig(cloudConfig);
    const lastUploadedAt =
      response.headers.get("x-snapshot-updated-at") || snapshot.createdAt;
    storeService.saveSettings({ cloudLastUploadedAt: lastUploadedAt });
    progress?.({ stage: "completed", percentage: 100 });
    return { success: true, lastUploadedAt };
  }

  private runExclusive(
    operation: () => Promise<CloudSyncResult>,
  ): Promise<CloudSyncResult> {
    if (this.shuttingDown) {
      return Promise.resolve({ success: false, error: "app_shutting_down" });
    }
    if (this.activeOperation) {
      return Promise.resolve({ success: false, error: "cloud_sync_busy" });
    }
    const active = operation().finally(() => {
      if (this.activeOperation === active) this.activeOperation = null;
    });
    this.activeOperation = active;
    return active;
  }

  handleAuthFailure(error?: string): boolean {
    if (error !== "session_expired" && error !== "session_invalid") {
      return false;
    }
    this.stopPresenceHeartbeat();
    this.presenceEnabled = false;
    this.emitPresenceChanged();
    storeService.saveSettings({
      cloudSessionToken: "",
      cloudSessionExpiresAt: "",
    });
    this.emitAuthChanged(error);
    return true;
  }

  private emitAuthChanged(reason: CloudAuthChangedReason): void {
    const payload: CloudAuthChangedPayload = {
      reason,
      status: this.getLocalStatus(),
    };
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC.SYSTEM_CLOUD_AUTH_CHANGED, payload);
  }

  private emitPresenceChanged(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(
      IPC.SYSTEM_CLOUD_PRESENCE_CHANGED,
      this.getPresenceStatus(),
    );
  }
}

export const cloudSyncService = new CloudSyncService();
