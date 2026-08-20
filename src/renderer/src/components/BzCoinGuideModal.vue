<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('bzCoinGuide.title')"
    style="width: 520px"
  >
    <div class="coin-balance">
      <img :src="bzCoinIcon" class="balance-icon" />
      <div>
        <div class="balance-label">{{ t("bzCoinGuide.balance") }}</div>
        <div class="balance-value">{{ userData?.bzCoins || 0 }}</div>
      </div>
    </div>

    <div class="earning-methods">
      <section class="earning-method">
        <div class="method-icon check-in-icon">
          <n-icon :component="CalendarOutline" size="24" />
        </div>
        <div class="method-content">
          <h3>{{ t("bzCoinGuide.checkInTitle") }}</h3>
          <p>{{ t("bzCoinGuide.checkInDescription") }}</p>
        </div>
      </section>

      <section class="earning-method">
        <div class="method-icon playtime-icon">
          <n-icon :component="GameControllerOutline" size="24" />
        </div>
        <div class="method-content">
          <h3>{{ t("bzCoinGuide.playtimeTitle") }}</h3>
          <p>{{ t("bzCoinGuide.playtimeDescription") }}</p>
        </div>
      </section>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { NIcon, NModal } from "naive-ui";
import { CalendarOutline, GameControllerOutline } from "@vicons/ionicons5";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../stores/useSettingsStore";
import bzCoinIcon from "../assets/images/bz-coin.png";

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  "update:show": [show: boolean];
}>();

const { t } = useI18n();
const { userData } = storeToRefs(useSettingsStore());

const show = computed({
  get: () => props.show,
  set: (value: boolean) => emit("update:show", value),
});
</script>

<style scoped>
.coin-balance {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
  border: 1px solid rgba(255, 215, 0, 0.28);
  border-radius: 12px;
  background: var(--bz-gold-soft);
}

.balance-icon {
  width: 38px;
  height: 38px;
}

.balance-label {
  color: var(--bz-text-secondary);
  font-size: 13px;
}

.balance-value {
  color: var(--bz-gold);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.earning-methods {
  display: grid;
  gap: 12px;
}

.earning-method {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px;
  border: 1px solid var(--bz-border-subtle);
  border-radius: 12px;
  background: var(--bz-bg-subtle);
}

.method-icon {
  display: flex;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
}

.check-in-icon {
  color: var(--bz-amber);
  background: rgba(240, 160, 32, 0.12);
}

.playtime-icon {
  color: var(--bz-info-blue);
  background: rgba(32, 128, 240, 0.12);
}

.method-content h3 {
  margin: 1px 0 5px;
  color: var(--bz-text-title);
  font-size: 15px;
}

.method-content p {
  margin: 0;
  color: var(--bz-text-secondary);
  font-size: 13px;
  line-height: 1.65;
}
</style>
