<template>
  <div class="social-page">
    <n-tabs v-model:value="activeTab" class="social-tabs" type="line" animated>
      <n-tab-pane name="forum" :tab="t('social.forum')">
        <div class="social-tab-content">
          <n-empty :description="t('social.developing')" />
        </div>
      </n-tab-pane>

      <n-tab-pane name="friends" :tab="t('social.friends')">
        <div class="social-tab-content">
          <n-empty :description="t('social.developing')" />
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const activeTab = ref<"forum" | "friends">("forum");
</script>

<style scoped>
.social-page {
  padding: 24px;
}

.social-tabs {
  margin-top: 0;
}

.social-tab-content {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  padding-top: 12px;
}
</style>
