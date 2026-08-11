import { defineStore } from "pinia";
import { ref } from "vue";

import { api } from "../api";
import {
  isPortalCapability,
  isPortalRole,
  type PortalCapability,
  type PortalRole,
} from "../rbac";

interface AdminUser {
  id: string;
  login: string;
  avatarUrl: string;
  role: PortalRole;
}

interface PortalSession {
  user: AdminUser;
  capabilities: PortalCapability[];
  expiresAt: string;
}

function parseSession(value: unknown): PortalSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const user = body.user;
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  const record = user as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.login !== "string" ||
    typeof record.avatarUrl !== "string" ||
    !isPortalRole(record.role) ||
    typeof body.expiresAt !== "string" ||
    !Array.isArray(body.capabilities) ||
    !body.capabilities.every(isPortalCapability)
  ) return null;
  return body as unknown as PortalSession;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AdminUser | null>(null);
  const capabilities = ref<ReadonlySet<PortalCapability>>(new Set());
  const checked = ref(false);
  let refreshPromise: Promise<void> | null = null;

  const can = (capability: PortalCapability) => capabilities.value.has(capability);

  function clear() {
    user.value = null;
    capabilities.value = new Set();
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const session = parseSession(await api<unknown>("/api/portal/v1/session"));
        if (!session) throw new Error("invalid_portal_session");
        user.value = session.user;
        capabilities.value = new Set(session.capabilities);
      } catch {
        clear();
      } finally {
        checked.value = true;
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  function login() {
    window.location.assign(
      `/auth/github/start?returnTo=${encodeURIComponent(window.location.href)}`,
    );
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    clear();
  }

  return { user, can, checked, refresh, login, logout };
});
