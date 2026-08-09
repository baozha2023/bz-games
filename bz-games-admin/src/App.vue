<template>
  <n-config-provider>
    <n-message-provider>
      <n-layout v-if="auth.user" has-sider class="app-shell">
        <n-layout-sider
          bordered
          :width="220"
          content-style="padding: 20px 12px;"
        >
          <div class="brand">BZ-Games</div>
          <div class="brand-subtitle">管理后台</div>
          <n-menu :value="String(route.name || '')" :options="menuOptions" />
        </n-layout-sider>
        <n-layout>
          <n-layout-header bordered class="app-header">
            <div>
              <strong>{{ pageTitle }}</strong>
              <div class="header-note">{{ pageDescription }}</div>
            </div>
            <n-space align="center">
              <n-avatar
                round
                :size="34"
                :src="auth.user.avatarUrl || undefined"
              />
              <span>{{ auth.user.login }}</span>
              <n-button size="small" @click="logout">退出登录</n-button>
            </n-space>
          </n-layout-header>
          <n-layout-content content-style="padding: 24px;">
            <router-view />
          </n-layout-content>
        </n-layout>
      </n-layout>
      <router-view v-else />
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, h } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useAuthStore } from "./stores/auth";
import type { PortalCapability } from "./rbac";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const menuDefinitions: Array<{ key: string; path: string; label: string; capability: PortalCapability }> = [
  { key: "feedback", path: "/feedback", label: "建言献策", capability: "feedback.read" },
  { key: "users", path: "/users", label: "用户列表", capability: "users.read" },
  { key: "game-hosting", path: "/game-hosting", label: "游戏托管", capability: "hosting.view" },
];
const menuOptions = computed(() => menuDefinitions
  .filter((item) => auth.can(item.capability))
  .map((item) => ({
    key: item.key,
    label: () => h(RouterLink, { to: item.path }, { default: () => item.label }),
  })));
const pageTitle = computed(() =>
  route.name === "game-hosting" ? "游戏托管" : route.name === "users" ? "用户列表" : "建言献策",
);
const pageDescription = computed(() =>
  route.name === "game-hosting"
    ? "上传和管理游戏市场安装包"
    : route.name === "users" ? "查看平台注册用户与 RBAC 角色" : "查看和处理玩家反馈",
);
async function logout() {
  await auth.logout();
  await router.replace({ name: "login" });
}
</script>
