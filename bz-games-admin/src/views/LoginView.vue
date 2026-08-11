<template>
  <main class="login-page">
    <n-card class="login-card" title="BZ-Games 创作者中心">
      <n-space vertical :size="18">
        <n-text v-if="auth.user" depth="3">
          当前账号
          {{ auth.user.login }} 尚未获得管理端权限，请联系超级管理员分配角色。
        </n-text>
        <n-text v-else depth="3">
          使用 GitHub 登录后，根据已分配的角色访问管理功能。
        </n-text>
        <n-button v-if="auth.user" block size="large" @click="auth.logout">
          退出登录
        </n-button>
        <n-button v-else type="primary" block size="large" @click="auth.login">
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
