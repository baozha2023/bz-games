<template>
  <main class="login-page">
    <n-card class="login-card" title="BZ-Games 创作者中心">
      <n-space vertical :size="18">
        <n-text depth="3">使用 GitHub 登录后投稿和管理自己的托管游戏。</n-text>
        <n-button type="primary" block size="large" @click="auth.login">
          使用 GitHub 登录
        </n-button>
      </n-space>
    </n-card>
  </main>
</template>

<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
</script>
