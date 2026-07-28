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
              <strong>建言献策</strong>
              <div class="header-note">查看和处理玩家反馈</div>
            </div>
            <n-space align="center">
              <n-avatar
                round
                :size="34"
                :src="auth.user.avatarUrl || undefined"
              />
              <span>{{ auth.user.login }}</span>
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
import { RouterLink, useRoute } from "vue-router";

import { useAuthStore } from "./stores/auth";

const route = useRoute();
const auth = useAuthStore();
const menuOptions = computed(() => [
  {
    label: () => h(RouterLink, { to: "/" }, { default: () => "建言献策" }),
    key: "feedback",
  },
]);
</script>
