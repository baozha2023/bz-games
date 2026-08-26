<template>
  <span class="forum-author-identity">
    <span class="forum-author-nickname">{{ nickname }}</span>
    <button
      v-if="normalizedLogin"
      class="forum-author-github"
      type="button"
      :title="`GitHub @${normalizedLogin}`"
      :aria-label="`GitHub @${normalizedLogin}`"
      @click.stop="openGitHubProfile"
      @keydown.stop
    >
      @{{ normalizedLogin }}
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  nickname: string;
  githubLogin?: string;
}>();

const GITHUB_LOGIN_PATTERN =
  /^(?:[A-Za-z\d]|[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d]))$/;

const normalizedLogin = computed(() => {
  const value = props.githubLogin?.trim().replace(/^@/, "") || "";
  return GITHUB_LOGIN_PATTERN.test(value) ? value : "";
});

function openGitHubProfile() {
  if (!normalizedLogin.value) return;
  void window.electronAPI.settings.openUrl(
    `https://github.com/${normalizedLogin.value}`,
  );
}
</script>

<style scoped>
.forum-author-identity {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: baseline;
}

.forum-author-nickname,
.forum-author-github {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-author-nickname {
  min-width: 0;
}

.forum-author-github {
  flex: 0 1 auto;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--bz-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.forum-author-github:hover,
.forum-author-github:focus-visible {
  color: var(--n-primary-color);
  text-decoration: underline;
}
</style>
