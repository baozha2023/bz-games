import { shell } from "electron";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_RELAY_SERVER_URL, OAUTH_RETURN_URL } from "../../../shared/AppConstants";
import { storeService } from "../storage/StoreService";
import { databaseService } from "../storage/DatabaseService";

export type CloudSyncProgressStage = "checking" | "uploading" | "downloading" | "applying" | "completed";

export interface CloudFileMeta {
  fileKey: "config.json" | "play_sessions.db";
  version: number;
  size: number;
  sha256: string;
  contentType: string;
  updatedAt: string;
}

export interface CloudSyncProgress {
  stage: CloudSyncProgressStage;
  percentage: number;
  fileKey?: CloudFileMeta["fileKey"];
}

export interface CloudSyncStatus {
  configured: boolean;
  authenticated: boolean;
  userLogin: string;
  userName: string;
  userProfileUrl: string;
  lastUploadedAt: string;
  files: Array<CloudFileMeta | null>;
}

type CloudSyncProgressHandler = (progress: CloudSyncProgress) => void;

const CLOUD_FILES: CloudFileMeta["fileKey"][] = ["config.json", "play_sessions.db"];

interface UploadSource {
  fileKey: CloudFileMeta["fileKey"];
  contentType: string;
  size: number;
  body: BodyInit;
}

function normalizeRelayHttpBase(): string {
  const relayUrl = DEFAULT_RELAY_SERVER_URL.trim();
  if (!relayUrl) return "";
  if (relayUrl.startsWith("wss://")) return `https://${relayUrl.slice("wss://".length)}`.replace(/\/+$/, "");
  if (relayUrl.startsWith("ws://")) return `http://${relayUrl.slice("ws://".length)}`.replace(/\/+$/, "");
  return relayUrl.replace(/\/+$/, "");
}

function getAuthHeaders(): Record<string, string> {
  const token = storeService.getSettings().cloudSessionToken || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function contentTypeFor(fileKey: CloudFileMeta["fileKey"]): string {
  return fileKey === "config.json" ? "application/json" : "application/sql; charset=utf-8";
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

class CloudSyncService {
  private readonly baseUrl = normalizeRelayHttpBase();

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async loginWithGitHub(): Promise<{ success: boolean; error?: string }> {
    if (!this.baseUrl) return { success: false, error: "cloud_not_configured" };
    const returnTo = OAUTH_RETURN_URL || "bzgames://oauth-complete";
    await shell.openExternal(`${this.baseUrl}/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`);
    return { success: true };
  }

  completeOAuth(urlText: string): boolean {
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      return false;
    }
    if (url.protocol !== "bzgames:" || url.hostname !== "oauth-complete") return false;
    const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.search.slice(1));
    const token = params.get("session_token") || "";
    if (!token) return false;
    storeService.saveSettings({
      cloudSessionToken: token,
      cloudSessionExpiresAt: params.get("expires_at") || "",
      cloudUserLogin: params.get("login") || "",
      cloudUserName: params.get("name") || "",
      cloudUserProfileUrl: params.get("profile_url") || "",
    });
    return true;
  }

  async getStatus(): Promise<CloudSyncStatus> {
    const settings = storeService.getSettings();
    const status = {
      configured: this.isConfigured(),
      authenticated: Boolean(settings.cloudSessionToken),
      userLogin: settings.cloudUserLogin || "",
      userName: settings.cloudUserName || "",
      userProfileUrl: settings.cloudUserProfileUrl || "",
      lastUploadedAt: settings.cloudLastUploadedAt || "",
      files: [] as Array<CloudFileMeta | null>,
    };
    if (!this.baseUrl || !settings.cloudSessionToken) return status;
    const authResponse = await fetch(`${this.baseUrl}/api/auth/me`, { headers: getAuthHeaders() });
    if (authResponse.status === 401) {
      storeService.saveSettings({ cloudSessionToken: "", cloudSessionExpiresAt: "", cloudUserLogin: "", cloudUserName: "", cloudUserProfileUrl: "" });
      return { ...status, authenticated: false, userLogin: "", userName: "", userProfileUrl: "" };
    }
    if (authResponse.ok) {
      const authBody = await authResponse.json() as { user?: { login?: string; name?: string; profileUrl?: string }; expiresAt?: string };
      const nextUserLogin = authBody.user?.login || settings.cloudUserLogin || "";
      const nextUserName = authBody.user?.name || settings.cloudUserName || "";
      const nextUserProfileUrl = authBody.user?.profileUrl || settings.cloudUserProfileUrl || "";
      const nextSessionExpiresAt = authBody.expiresAt || settings.cloudSessionExpiresAt || "";
      if (
        nextUserLogin !== settings.cloudUserLogin ||
        nextUserName !== settings.cloudUserName ||
        nextUserProfileUrl !== settings.cloudUserProfileUrl ||
        nextSessionExpiresAt !== settings.cloudSessionExpiresAt
      ) {
        storeService.saveSettings({
          cloudUserLogin: nextUserLogin,
          cloudUserName: nextUserName,
          cloudUserProfileUrl: nextUserProfileUrl,
          cloudSessionExpiresAt: nextSessionExpiresAt,
        });
      }
      status.userLogin = nextUserLogin;
      status.userName = nextUserName;
      status.userProfileUrl = nextUserProfileUrl;
    }
    const response = await fetch(`${this.baseUrl}/api/cloud/files`, { headers: getAuthHeaders() });
    if (response.status === 401) {
      storeService.saveSettings({ cloudSessionToken: "", cloudSessionExpiresAt: "", cloudUserLogin: "", cloudUserName: "", cloudUserProfileUrl: "" });
      return { ...status, authenticated: false, userLogin: "", userName: "", userProfileUrl: "" };
    }
    if (!response.ok) return status;
    const body = await response.json() as { files?: Array<CloudFileMeta | null> };
    const files = Array.isArray(body.files) ? body.files : [];
    const latestUploadTime = files
      .filter((item): item is CloudFileMeta => Boolean(item?.updatedAt))
      .map((item) => new Date(item.updatedAt).getTime())
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => b - a)[0];
    const lastUploadedAt = latestUploadTime ? new Date(latestUploadTime).toISOString() : settings.cloudLastUploadedAt || "";
    if (lastUploadedAt && lastUploadedAt !== settings.cloudLastUploadedAt) {
      storeService.saveSettings({ cloudLastUploadedAt: lastUploadedAt });
    }
    return { ...status, authenticated: true, files, lastUploadedAt };
  }

  async upload(progress?: CloudSyncProgressHandler): Promise<{ success: boolean; lastUploadedAt?: string; error?: string }> {
    if (!this.baseUrl) return { success: false, error: "cloud_not_configured" };
    if (!storeService.getSettings().cloudSessionToken) return { success: false, error: "unauthorized" };
    progress?.({ stage: "checking", percentage: 5 });
    const sqlDump = databaseService.exportCloudSqlDump();
    const uploadSources: UploadSource[] = [
      {
        fileKey: "config.json",
        contentType: contentTypeFor("config.json"),
        size: fs.statSync(storeService.getConfigPath()).size,
        body: fs.createReadStream(storeService.getConfigPath()) as unknown as BodyInit,
      },
      {
        fileKey: "play_sessions.db",
        contentType: contentTypeFor("play_sessions.db"),
        size: Buffer.byteLength(sqlDump),
        body: sqlDump,
      },
    ];
    const totalBytes = uploadSources.reduce((sum, source) => sum + source.size, 0) || 1;
    let uploadedBytes = 0;
    let latestUploadedAt = "";
    let operationId = "";
    for (const source of uploadSources) {
      const response = await fetch(`${this.baseUrl}/api/cloud/files/${encodeURIComponent(source.fileKey)}`, {
        method: "PUT",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": source.contentType,
          "Content-Length": String(source.size),
          ...(operationId ? { "X-Cloud-Operation-Id": operationId } : {}),
        },
        body: source.body,
        duplex: "half",
      } as RequestInit);
      operationId = response.headers.get("x-cloud-operation-id") || operationId;
      uploadedBytes += source.size;
      progress?.({ stage: "uploading", percentage: Math.min(95, Math.round((uploadedBytes / totalBytes) * 90) + 5), fileKey: source.fileKey });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        return { success: false, error: body.error || `upload_failed_${response.status}` };
      }
      const body = await response.json() as { file?: CloudFileMeta };
      if (body.file?.updatedAt) latestUploadedAt = body.file.updatedAt;
    }
    const lastUploadedAt = latestUploadedAt || new Date().toISOString();
    storeService.saveSettings({ cloudLastUploadedAt: lastUploadedAt });
    progress?.({ stage: "completed", percentage: 100 });
    return { success: true, lastUploadedAt };
  }

  async download(progress?: CloudSyncProgressHandler): Promise<{ success: boolean; lastUploadedAt?: string; error?: string }> {
    if (!this.baseUrl) return { success: false, error: "cloud_not_configured" };
    if (!storeService.getSettings().cloudSessionToken) return { success: false, error: "unauthorized" };
    progress?.({ stage: "checking", percentage: 5 });
    const status = await this.getStatus();
    const metas = CLOUD_FILES.map((fileKey) => status.files.find((item) => item?.fileKey === fileKey) || null);
    if (metas.some((item) => !item)) return { success: false, error: "cloud_data_incomplete" };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bz-cloud-sync-"));
    try {
      const totalBytes = metas.reduce((sum, item) => sum + (item?.size || 0), 0) || 1;
      let downloadedBytes = 0;
      let operationId = "";
      for (let index = 0; index < CLOUD_FILES.length; index += 1) {
        const fileKey = CLOUD_FILES[index];
        const meta = metas[index];
        const response = await fetch(`${this.baseUrl}/api/cloud/files/${encodeURIComponent(fileKey)}`, {
          headers: {
            ...getAuthHeaders(),
            ...(operationId ? { "X-Cloud-Operation-Id": operationId } : {}),
          },
        });
        operationId = response.headers.get("x-cloud-operation-id") || operationId;
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          return { success: false, error: body.error || `download_failed_${response.status}` };
        }
        const tempPath = path.join(tempDir, fileKey);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (meta?.sha256 && sha256(buffer) !== meta.sha256) {
          return { success: false, error: "cloud_hash_mismatch" };
        }
        fs.writeFileSync(tempPath, buffer);
        downloadedBytes += buffer.length;
        progress?.({ stage: "downloading", percentage: Math.min(80, Math.round((downloadedBytes / totalBytes) * 75) + 5), fileKey });
      }
      progress?.({ stage: "applying", percentage: 90 });
      const currentSettings = storeService.getSettings();
      storeService.replaceConfigFile(path.join(tempDir, "config.json"));
      await storeService.init(true);
      databaseService.importCloudSqlDump(fs.readFileSync(path.join(tempDir, "play_sessions.db"), "utf8"));
      storeService.saveSettings({
        cloudLastUploadedAt: status.lastUploadedAt,
        cloudSessionToken: currentSettings.cloudSessionToken,
        cloudSessionExpiresAt: currentSettings.cloudSessionExpiresAt,
        cloudUserLogin: currentSettings.cloudUserLogin,
        cloudUserName: currentSettings.cloudUserName,
        cloudUserProfileUrl: currentSettings.cloudUserProfileUrl,
      });
      progress?.({ stage: "completed", percentage: 100 });
      return { success: true, lastUploadedAt: status.lastUploadedAt };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export const cloudSyncService = new CloudSyncService();
