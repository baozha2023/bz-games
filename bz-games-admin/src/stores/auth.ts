import { defineStore } from "pinia";
import { ref } from "vue";

import { api } from "../api";
import { hasCapability, type PortalCapability, type PortalRole } from "../rbac";

interface AdminUser {
  id: string;
  login: string;
  avatarUrl: string;
  role: PortalRole;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AdminUser | null>(null);
  const role = ref<PortalRole>("player");
  const checked = ref(false);
  const can = (capability: PortalCapability) => hasCapability(role.value, capability);

  async function refresh() {
    try {
      let body = await api<{ user: AdminUser; role: PortalRole }>("/api/auth/me");
      if (body.role === "player") {
        await api<{ ok: true; role: "creator" }>("/api/portal/v1/activate", {
          method: "POST",
        });
        body = await api<{ user: AdminUser; role: PortalRole }>("/api/auth/me");
      }
      user.value = body.user;
      role.value = body.role;
    } catch {
      user.value = null;
      role.value = "player";
    } finally {
      checked.value = true;
    }
  }

  function login() {
    const returnTo = window.location.href;
    window.location.assign(
      `/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    user.value = null;
    role.value = "player";
  }

  return { user, role, can, checked, refresh, login, logout };
});
