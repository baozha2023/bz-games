import { defineStore } from "pinia";
import { ref } from "vue";

import { api } from "../api";

interface AdminUser {
  login: string;
  avatarUrl: string;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AdminUser | null>(null);
  const checked = ref(false);

  async function refresh() {
    try {
      const body = await api<{ user: AdminUser }>("/api/admin/v1/me");
      user.value = body.user;
    } catch {
      user.value = null;
    } finally {
      checked.value = true;
    }
  }

  function login() {
    const returnTo = `${window.location.origin}/admin/`;
    window.location.assign(
      `/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  return { user, checked, refresh, login };
});
