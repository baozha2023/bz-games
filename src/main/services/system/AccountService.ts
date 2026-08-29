import {
  DEFAULT_RELAY_SERVER_URL,
  OAUTH_RETURN_URL,
} from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { storeService } from "../storage/StoreService";
import { openExternalHttpUrl } from "../../utils/externalUrl";
import { logger } from "../../utils/logger";
import { mainWindow } from "../../window";
import { IPC } from "../../../shared/ipc-channels";
import type {
  AccountAuthChangedPayload,
  AccountAuthChangedReason,
  AccountPresenceStatus,
  LocalAccountStatus,
} from "../../../shared/types";

const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
const PRESENCE_REQUEST_TIMEOUT_MS = 10_000;
const LOGOUT_REQUEST_TIMEOUT_MS = 10_000;

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

function getAccountHeaders(
  url: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = storeService.getSettings().accountSessionToken || "";
  return requestInterceptor.buildHeaders(
    url,
    token ? { ...extra, Authorization: `Bearer ${token}` } : extra,
  );
}

export class AccountService {
  private readonly baseUrl = normalizeRelayHttpBase();
  private logoutRequest: Promise<{ success: boolean; error?: string }> | null =
    null;
  private presenceEnabled = false;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceRequest: Promise<boolean> | null = null;
  private presenceTransition: Promise<AccountPresenceStatus> = Promise.resolve({
    enabled: false,
  });
  private shuttingDown = false;

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async loginWithGitHub(): Promise<{ success: boolean; error?: string }> {
    if (this.shuttingDown)
      return { success: false, error: "app_shutting_down" };
    if (!this.baseUrl)
      return { success: false, error: "account_not_configured" };
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
      accountSessionToken: token,
      accountSessionExpiresAt: params.get("expires_at") || "",
      accountUserLogin: params.get("login") || "",
      accountUserName: params.get("name") || "",
      accountUserProfileUrl: params.get("profile_url") || "",
    });
    void this.syncPlayerName(storeService.getSettings().playerName);
    this.emitAuthChanged("login");
    return true;
  }

  async logout(): Promise<{ success: boolean; error?: string }> {
    if (this.shuttingDown) {
      return { success: false, error: "app_shutting_down" };
    }
    if (this.logoutRequest) return this.logoutRequest;
    const request = this.performLogout().finally(() => {
      if (this.logoutRequest === request) this.logoutRequest = null;
    });
    this.logoutRequest = request;
    return request;
  }

  getPresenceStatus(): AccountPresenceStatus {
    return { enabled: this.presenceEnabled };
  }

  async setPresenceEnabled(enabled: boolean): Promise<AccountPresenceStatus> {
    const transition = this.presenceTransition.then(() =>
      this.performPresenceTransition(enabled),
    );
    this.presenceTransition = transition;
    return transition;
  }

  private async performPresenceTransition(
    enabled: boolean,
  ): Promise<AccountPresenceStatus> {
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
      !storeService.getSettings().accountSessionToken
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
    if (!this.baseUrl || !storeService.getSettings().accountSessionToken)
      return;
    await this.sendPresence(false);
  }

  async syncPlayerName(playerName: string): Promise<void> {
    if (!this.baseUrl || !storeService.getSettings().accountSessionToken)
      return;

    const url = `${this.baseUrl}/api/v1/me/profile`;
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: getAccountHeaders(url, {
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
        `[AccountService] Failed to sync playerName (${response.status}):`,
        body.error || "unknown_error",
      );
    } catch (error) {
      logger.warn("[AccountService] Failed to sync playerName:", error);
    }
  }

  getLocalStatus(): LocalAccountStatus {
    const settings = storeService.getSettings();
    const authenticated = Boolean(settings.accountSessionToken);
    return {
      configured: this.isConfigured(),
      authenticated,
      userLogin: authenticated ? settings.accountUserLogin || "" : "",
      userName: authenticated ? settings.accountUserName || "" : "",
      userProfileUrl: authenticated ? settings.accountUserProfileUrl || "" : "",
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopPresenceHeartbeat();
    await this.logoutRequest;
    await this.presenceTransition;
    this.presenceEnabled = false;
    if (this.baseUrl && storeService.getSettings().accountSessionToken) {
      await this.sendPresence(false);
    }
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
    if (!this.baseUrl || !storeService.getSettings().accountSessionToken) {
      return false;
    }
    while (this.presenceRequest) await this.presenceRequest;

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
        headers: getAccountHeaders(url, {
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
        `[AccountService] Failed to update presence (${response.status}):`,
        body.error || "unknown_error",
      );
      return false;
    } catch (error) {
      logger.warn("[AccountService] Failed to update presence:", error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async performLogout(): Promise<{ success: boolean; error?: string }> {
    if (!this.baseUrl)
      return { success: false, error: "account_not_configured" };
    if (!storeService.getSettings().accountSessionToken) {
      this.clearLocalSession();
      return { success: true };
    }

    await this.setPresenceEnabled(false);
    // A failing offline-presence call may have already cleared a dead session.
    if (!storeService.getSettings().accountSessionToken) {
      return { success: true };
    }

    const url = `${this.baseUrl}/api/v1/me/session`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      LOGOUT_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: getAccountHeaders(url),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (
        !response.ok &&
        body.error !== "session_expired" &&
        body.error !== "session_invalid"
      ) {
        return {
          success: false,
          error: body.error || "logout_failed",
        };
      }
      this.clearLocalSession();
      return { success: true };
    } catch (error) {
      logger.warn("[AccountService] Failed to revoke account session:", error);
      return { success: false, error: "logout_network_error" };
    } finally {
      clearTimeout(timeout);
    }
  }

  private clearLocalSession(reason: AccountAuthChangedReason = "logout"): void {
    storeService.saveSettings({
      accountSessionToken: "",
      accountSessionExpiresAt: "",
      accountUserLogin: "",
      accountUserName: "",
      accountUserProfileUrl: "",
    });
    this.emitAuthChanged(reason);
  }

  handleAuthFailure(error?: string): boolean {
    if (error !== "session_expired" && error !== "session_invalid") {
      return false;
    }
    this.stopPresenceHeartbeat();
    this.presenceEnabled = false;
    this.emitPresenceChanged();
    this.clearLocalSession(error);
    return true;
  }

  private emitAuthChanged(reason: AccountAuthChangedReason): void {
    const payload: AccountAuthChangedPayload = {
      reason,
      status: this.getLocalStatus(),
    };
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC.SYSTEM_ACCOUNT_AUTH_CHANGED, payload);
  }

  private emitPresenceChanged(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(
      IPC.SYSTEM_ACCOUNT_PRESENCE_CHANGED,
      this.getPresenceStatus(),
    );
  }
}

export const accountService = new AccountService();
