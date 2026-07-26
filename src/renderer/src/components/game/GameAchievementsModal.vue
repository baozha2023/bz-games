<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('achievement.title')"
    style="max-width: 60vw"
  >
    <n-empty
      v-if="achievements.length === 0"
      :description="t('achievement.noAchievements')"
    />
    <div v-else class="achievement-list">
      <n-list>
        <n-list-item v-for="ach in achievements" :key="ach.id">
          <n-thing>
            <template #avatar>
              <AchievementIcon
                :game-id="gameId"
                :version="version"
                :achievement-id="ach.id"
                :has-custom-icon="!!ach.icon"
                :locked="!ach.unlocked"
                :size="48"
              />
            </template>
            <template #header>
              <div style="margin-left: 8px">{{ ach.title }}</div>
            </template>
            <template #description>
              <div style="margin-left: 8px">{{ ach.description }}</div>
            </template>
            <template #header-extra>
              <n-tag type="success" v-if="ach.unlocked">{{
                t("achievement.unlocked")
              }}</n-tag>
              <n-tag type="default" v-else>{{ t("achievement.locked") }}</n-tag>
            </template>
          </n-thing>
        </n-list-item>
      </n-list>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { NModal, NEmpty, NList, NListItem, NThing, NTag } from "naive-ui";
import AchievementIcon from "./AchievementIcon.vue";

const { t } = useI18n();

const props = defineProps<{
  show: boolean;
  achievements: any[];
  gameId: string;
  version: string;
}>();

const emit = defineEmits<{
  (e: "update:show", value: boolean): void;
}>();

const show = computed({
  get: () => props.show,
  set: (val) => emit("update:show", val),
});
</script>

<style scoped>
.achievement-list {
  max-height: 80vh;
  overflow-y: auto;
  padding-right: 4px;
}
</style>
