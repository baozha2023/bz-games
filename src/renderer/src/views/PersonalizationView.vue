<template>
  <div style="padding: 24px">
    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane name="avatarFrame" :tab="t('personalization.avatarFrame')">
        <div style="padding-top: 16px">
          <n-empty
            v-if="frames.length === 0"
            :description="t('personalization.noFrames')"
            style="margin-top: 60px"
          />
          <n-grid
            v-else
            :x-gap="16"
            :y-gap="16"
            :cols="'2 s:3 m:4 l:4 xl:5'"
            responsive="screen"
          >
            <n-grid-item v-for="frame in frames" :key="frame.id">
              <div
                class="frame-card"
                :class="{ 'frame-equipped': isEquipped(frame.id) }"
              >
                <div class="frame-preview" @click="handleEquipOrToggle(frame)">
                  <div class="frame-preview-badge" v-if="isEquipped(frame.id)">
                    <n-icon :size="18" :color="'#fff'">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                      >
                        <path
                          fill="currentColor"
                          d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                        />
                      </svg>
                    </n-icon>
                  </div>
                  <AvatarWithFrame
                    :src="settingsStore.settings?.avatar"
                    :name="settingsStore.settings?.playerName || ''"
                    :size="96"
                    :frame-file-name="frame.imageFileName"
                  />
                </div>

                <div class="frame-body">
                  <div class="frame-title">
                    {{ frame.name }}
                  </div>
                  <div class="frame-condition">
                    <n-icon size="12" :component="unlockIcon(frame)" />
                    <span>{{ unlockText(frame) }}</span>
                  </div>

                  <div class="frame-actions">
                    <n-button
                      v-if="isEquipped(frame.id)"
                      type="success"
                      size="small"
                      block
                      secondary
                      @click="handleUnequip(frame.id)"
                    >
                      {{ t("personalization.unequip") }}
                    </n-button>
                    <n-button
                      v-else-if="isUnlocked(frame)"
                      type="primary"
                      size="small"
                      block
                      secondary
                      @click="handleEquip(frame.id)"
                    >
                      {{ t("personalization.equip") }}
                    </n-button>
                    <n-button
                      v-else
                      :type="
                        frame.unlock.type === 'bzcoin' ? 'warning' : 'primary'
                      "
                      size="small"
                      block
                      secondary
                      @click="handleUnlockFrame(frame)"
                    >
                      {{ conditionActionText(frame.unlock) }}
                    </n-button>
                  </div>
                </div>
              </div>
            </n-grid-item>
          </n-grid>
        </div>
      </n-tab-pane>
      <n-tab-pane name="gameCard" :tab="t('personalization.gameCard')">
        <div class="game-card-product-panel">
          <n-grid
            :x-gap="16"
            :y-gap="16"
            :cols="'1 s:2 m:3'"
            responsive="screen"
          >
            <n-grid-item v-for="product in gameCardProducts" :key="product.id">
              <n-card
                class="game-card-product-card"
                :class="{
                  'game-card-product-equipped': isProductEquipped(product.id),
                }"
              >
                <div class="game-card-product-previews">
                  <div class="game-card-product-preview square-preview">
                    <GameIconCard
                      :game="previewGame"
                      :frame-product-id="product.id"
                      :preview-icon-url="defaultIconUrl"
                      :interactive="false"
                    />
                    <span class="preview-ratio">1:1</span>
                  </div>
                  <div class="game-card-product-preview wide-preview">
                    <GameCard
                      :game="previewGame"
                      :frame-product-id="product.id"
                      :preview-cover-url="defaultCoverUrl"
                      :interactive="false"
                    />
                    <span class="preview-ratio">16:9</span>
                  </div>
                </div>
                <div class="game-card-product-title-row">
                  <div class="game-card-product-title">{{ product.name }}</div>
                </div>
                <n-text depth="3" class="game-card-product-description">
                  {{ product.description }}
                </n-text>
                <div class="game-card-product-condition">
                  <n-icon :component="productUnlockIcon(product)" size="15" />
                  <span>{{ productUnlockText(product) }}</span>
                  <span
                    v-if="
                      productProgress[product.id] &&
                      !isProductUnlocked(product.id)
                    "
                    class="game-card-product-progress"
                  >
                    {{
                      productProgressText(product, productProgress[product.id])
                    }}
                  </span>
                </div>
                <n-button
                  block
                  secondary
                  :type="productActionType(product)"
                  :loading="productBusyId === product.id"
                  @click="handleProductAction(product)"
                >
                  {{ productActionText(product) }}
                </n-button>
              </n-card>
            </n-grid-item>
          </n-grid>
        </div>
      </n-tab-pane>
      <n-tab-pane
        name="nicknameStyle"
        :tab="t('personalization.nicknameStyle')"
      >
        <div class="nickname-style-panel">
          <n-card class="nickname-preview-card" :bordered="false">
            <div class="nickname-preview-stage">
              <NicknameText
                :name="settingsStore.settings?.playerName || ''"
                :nickname-style="nicknameStyleForm"
                :effective-theme="settingsStore.effectiveTheme"
                size="clamp(1.45rem, 2.6vw, 2rem)"
              />
              <div class="nickname-preview-room">
                <NicknameText
                  :name="`${settingsStore.settings?.playerName || ''} 的房间`"
                  :nickname-style="nicknameStyleForm"
                  :effective-theme="settingsStore.effectiveTheme"
                  size="clamp(1rem, 1.8vw, 1.25rem)"
                />
              </div>
            </div>
          </n-card>

          <n-card :title="t('personalization.nicknameStyle')" :bordered="false">
            <n-alert type="info" class="nickname-style-tip">
              {{ t("personalization.gradientHelp") }}
            </n-alert>
            <n-form label-placement="left" label-width="120">
              <n-form-item :label="t('personalization.nicknameColor')">
                <n-color-picker
                  v-model:value="nicknameStyleForm.color"
                  :show-alpha="false"
                  :modes="['hex']"
                />
              </n-form-item>
              <n-alert
                v-if="!canSaveNicknameStyle"
                type="warning"
                class="nickname-style-tip"
              >
                {{ t("personalization.nicknameColorContrastWarning") }}
              </n-alert>
              <n-form-item :label="t('personalization.nicknameFont')">
                <n-select
                  v-model:value="nicknameStyleForm.font"
                  :options="fontOptions"
                />
              </n-form-item>
              <n-form-item :label="t('personalization.nicknameWeight')">
                <n-select
                  v-model:value="nicknameStyleForm.weight"
                  :options="weightOptions"
                />
              </n-form-item>
              <n-form-item :label="t('personalization.nicknameEffect')">
                <n-select
                  v-model:value="nicknameStyleForm.effect"
                  :options="effectOptions"
                />
              </n-form-item>
              <template v-if="supportsGradient">
                <n-form-item :label="t('personalization.gradientStart')">
                  <n-color-picker
                    v-model:value="nicknameStyleForm.gradientStart"
                    :show-alpha="false"
                    :modes="['hex']"
                  />
                </n-form-item>
                <n-form-item :label="t('personalization.gradientEnd')">
                  <n-color-picker
                    v-model:value="nicknameStyleForm.gradientEnd"
                    :show-alpha="false"
                    :modes="['hex']"
                  />
                </n-form-item>
              </template>
              <n-space justify="end">
                <n-button @click="resetNicknameStyle">{{
                  t("personalization.resetNicknameStyle")
                }}</n-button>
                <n-button
                  type="primary"
                  :disabled="!canSaveNicknameStyle"
                  @click="saveNicknameStyle"
                >
                  {{
                    t("personalization.saveNicknameStyleCost", {
                      coins: NICKNAME_STYLE_SAVE_COST,
                    })
                  }}
                </n-button>
              </n-space>
            </n-form>
          </n-card>
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import { useRoute } from "vue-router";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
  TimeOutline,
  CalendarOutline,
  TodayOutline,
  WalletOutline,
} from "@vicons/ionicons5";
import AvatarWithFrame from "../components/AvatarWithFrame.vue";
import NicknameText from "../components/NicknameText.vue";
import GameCard from "../components/game/GameCard.vue";
import GameIconCard from "../components/game/GameIconCard.vue";
import { DEFAULT_NICKNAME_STYLE } from "../../../shared/types";
import type {
  AvatarFrameDef,
  GameCardProductDef,
  ManualUnlockResult,
  ManualUnlockCondition,
  NicknameEffect,
  NicknameFont,
  NicknameStyle,
} from "../../../shared/types";
import { GameType } from "../../../shared/types";
import { AVATAR_FRAMES } from "../../../shared/avatar-frames";
import { GAME_CARD_PRODUCTS } from "../../../shared/game-card-products";
import type { GameManifest } from "../../../shared/game-manifest";
import defaultCoverUrl from "../../../../resources/default_cover.png";
import defaultIconUrl from "../../../../resources/default_icon.png";
import {
  adaptNicknameStyleForTheme,
  isNicknameColorAllowedForTheme,
  normalizeNicknameHexColor,
} from "../utils/nicknameColor";

const { t } = useI18n();
const settingsStore = useSettingsStore();
const message = useMessage();
const route = useRoute();

const personalizationTabs = new Set([
  "avatarFrame",
  "gameCard",
  "nicknameStyle",
]);
const routePersonalizationTab = () =>
  typeof route.query.tab === "string" &&
  personalizationTabs.has(route.query.tab)
    ? route.query.tab
    : "avatarFrame";
const activeTab = ref(routePersonalizationTab());
watch(
  () => route.query.tab,
  () => {
    activeTab.value = routePersonalizationTab();
  },
);
const frames = ref<AvatarFrameDef[]>(AVATAR_FRAMES);
const gameCardProducts = ref<GameCardProductDef[]>(GAME_CARD_PRODUCTS);
const nicknameStyleForm = ref<NicknameStyle>({ ...DEFAULT_NICKNAME_STYLE });
const NICKNAME_STYLE_SAVE_COST = 30;
const productBusyId = ref<string | null>(null);
const productProgress = ref<Record<string, ManualUnlockResult>>({});
const previewGame: GameManifest = {
  id: "com.bz.preview",
  name: "游戏名",
  version: "1.0.0",
  author: "作者",
  platformVersion: ">=1.0.0",
  entry: "preview.html",
  type: GameType.Singleplayer,
};

const userData = computed(() => settingsStore.userData);
const equippedFrame = computed(() => userData.value?.equippedFrame);
const gradientEffects: NicknameEffect[] = [
  "flame",
  "neon",
  "aurora",
  "crystal",
  "comet",
  "hologram",
  "inkflow",
  "eclipse",
];
const supportsGradient = computed(() =>
  gradientEffects.includes(nicknameStyleForm.value.effect),
);
const canSaveNicknameStyle = computed(() =>
  isNicknameColorAllowedForTheme(
    nicknameStyleForm.value.color,
    settingsStore.effectiveTheme,
  ),
);

const fontOptions = computed(() => [
  { label: t("personalization.fontSystem"), value: "system" as NicknameFont },
  { label: t("personalization.fontRounded"), value: "rounded" as NicknameFont },
  { label: t("personalization.fontSerif"), value: "serif" as NicknameFont },
  { label: t("personalization.fontMono"), value: "mono" as NicknameFont },
  { label: t("personalization.fontFantasy"), value: "fantasy" as NicknameFont },
]);

const weightOptions = computed(() => [
  { label: t("personalization.weightNormal"), value: "normal" },
  { label: t("personalization.weightSemibold"), value: "semibold" },
  { label: t("personalization.weightBold"), value: "bold" },
]);

const effectOptions = computed(() => [
  { label: t("personalization.effectNone"), value: "none" as NicknameEffect },
  { label: t("personalization.effectGlow"), value: "glow" as NicknameEffect },
  { label: t("personalization.effectFlame"), value: "flame" as NicknameEffect },
  { label: t("personalization.effectNeon"), value: "neon" as NicknameEffect },
  {
    label: t("personalization.effectAurora"),
    value: "aurora" as NicknameEffect,
  },
  {
    label: t("personalization.effectCrystal"),
    value: "crystal" as NicknameEffect,
  },
  { label: t("personalization.effectComet"), value: "comet" as NicknameEffect },
  {
    label: t("personalization.effectHeartbeat"),
    value: "heartbeat" as NicknameEffect,
  },
  {
    label: t("personalization.effectHologram"),
    value: "hologram" as NicknameEffect,
  },
  {
    label: t("personalization.effectInkflow"),
    value: "inkflow" as NicknameEffect,
  },
  {
    label: t("personalization.effectEclipse"),
    value: "eclipse" as NicknameEffect,
  },
]);

function normalizeNicknameStyleHexColors(style: NicknameStyle): NicknameStyle {
  return {
    ...style,
    color: normalizeNicknameHexColor(style.color) || style.color,
    gradientStart:
      normalizeNicknameHexColor(style.gradientStart) || style.gradientStart,
    gradientEnd:
      normalizeNicknameHexColor(style.gradientEnd) || style.gradientEnd,
  };
}

function syncNicknameStyleForm() {
  const style = adaptNicknameStyleForTheme(
    {
      ...DEFAULT_NICKNAME_STYLE,
      ...(settingsStore.settings?.nicknameStyle || {}),
    },
    settingsStore.effectiveTheme,
  ) || { ...DEFAULT_NICKNAME_STYLE };
  nicknameStyleForm.value = normalizeNicknameStyleHexColors(style);
}

function isEquipped(frameId: string): boolean {
  return equippedFrame.value === frameId;
}

function isUnlocked(frame: AvatarFrameDef): boolean {
  if (!userData.value) return false;
  return userData.value.ownedFrames.includes(frame.id);
}

function unlockText(frame: AvatarFrameDef): string {
  switch (frame.unlock.type) {
    case "playtime":
      return t("personalization.unlockPlaytime", {
        hours: Math.max(1, Math.floor(frame.unlock.durationMs / 3600000)),
      });
    case "consecutive_checkin":
      return t("personalization.unlockConsecutiveCheckIn", {
        days: frame.unlock.days,
      });
    case "total_checkin":
      return t("personalization.unlockTotalCheckIn", {
        days: frame.unlock.days,
      });
    case "bzcoin":
      return t("personalization.unlockBzCoin", { coins: frame.unlock.amount });
    default:
      return "";
  }
}

function unlockIcon(frame: AvatarFrameDef) {
  switch (frame.unlock.type) {
    case "playtime":
      return TimeOutline;
    case "consecutive_checkin":
      return TodayOutline;
    case "total_checkin":
      return CalendarOutline;
    case "bzcoin":
      return WalletOutline;
    default:
      return TimeOutline;
  }
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(durationMs / 60000));
  if (totalMinutes < 60) {
    return t("personalization.durationMinutes", { minutes: totalMinutes });
  }
  return t("personalization.durationHoursMinutes", {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  });
}

function productUnlockText(product: GameCardProductDef): string {
  const unlock = product.unlock;
  switch (unlock.type) {
    case "bzcoin":
      return t("personalization.unlockBzCoin", { coins: unlock.amount });
    case "playtime":
      return t("personalization.unlockPlaytimeDuration", {
        duration: formatDuration(unlock.durationMs),
      });
    case "total_checkin":
      return t("personalization.unlockTotalCheckIn", { days: unlock.days });
    case "consecutive_checkin":
      return t("personalization.unlockConsecutiveCheckIn", {
        days: unlock.days,
      });
    case "date_playtime":
      return t("personalization.unlockDatePlaytime", {
        date: unlock.date,
        duration: formatDuration(unlock.durationMs),
      });
  }
}

function productUnlockIcon(product: GameCardProductDef) {
  switch (product.unlock.type) {
    case "bzcoin":
      return WalletOutline;
    case "playtime":
      return TimeOutline;
    case "total_checkin":
      return CalendarOutline;
    case "consecutive_checkin":
      return TodayOutline;
    case "date_playtime":
      return TodayOutline;
  }
}

function productProgressText(
  product: GameCardProductDef,
  progress: ManualUnlockResult,
): string {
  if (progress.current === undefined || progress.required === undefined) {
    return "";
  }
  const current =
    product.unlock.type === "playtime" ||
    product.unlock.type === "date_playtime"
      ? formatDuration(progress.current)
      : product.unlock.type === "bzcoin"
        ? `${progress.current} BZ`
        : `${progress.current} 天`;
  const required =
    product.unlock.type === "playtime" ||
    product.unlock.type === "date_playtime"
      ? formatDuration(progress.required)
      : product.unlock.type === "bzcoin"
        ? `${progress.required} BZ`
        : `${progress.required} 天`;
  return t("personalization.unlockProgress", { current, required });
}

async function refreshProductProgress() {
  const progressEntries = await Promise.all(
    gameCardProducts.value.map(
      async (product) =>
        [
          product.id,
          await window.electronAPI.user.getGameCardProductProgress(product.id),
        ] as const,
    ),
  );
  productProgress.value = Object.fromEntries(progressEntries);
}

function conditionActionText(condition: ManualUnlockCondition): string {
  return condition.type === "bzcoin"
    ? t("personalization.buy")
    : t("personalization.unlock");
}

function handleUnlockFailure(result: { code?: string }) {
  if (result.code === "insufficient_coins") {
    message.error(t("personalization.insufficientCoins"));
  } else if (result.code === "condition_not_met") {
    message.warning(t("personalization.conditionNotMet"));
  } else if (result.code === "already_owned") {
    message.info(t("personalization.alreadyOwned"));
  } else {
    message.error(t("settings.saveFail"));
  }
}

function productActionText(product: GameCardProductDef): string {
  if (isProductEquipped(product.id)) return t("personalization.equipped");
  if (isProductUnlocked(product.id)) return t("personalization.equip");
  return conditionActionText(product.unlock);
}

function productActionType(product: GameCardProductDef) {
  if (isProductEquipped(product.id)) return "success" as const;
  if (product.unlock.type === "bzcoin") return "warning" as const;
  return "primary" as const;
}

function isProductUnlocked(productId: string): boolean {
  return Boolean(userData.value?.ownedGameCardProducts.includes(productId));
}

function isProductEquipped(productId: string): boolean {
  return userData.value?.equippedGameCardProduct === productId;
}

function handleEquipOrToggle(frame: AvatarFrameDef) {
  if (isEquipped(frame.id)) {
    handleUnequip(frame.id);
  } else if (isUnlocked(frame)) {
    handleEquip(frame.id);
  }
}

async function handleEquip(frameId: string) {
  await window.electronAPI.user.equipFrame(frameId);
  await settingsStore.loadUserData();
}

async function handleUnequip(frameId: string) {
  await window.electronAPI.user.unequipFrame(frameId);
  await settingsStore.loadUserData();
}

async function handleUnlockFrame(frame: AvatarFrameDef) {
  const result = await window.electronAPI.user.unlockFrame(frame.id);
  if (!result.success) {
    handleUnlockFailure(result);
    return;
  }
  await settingsStore.loadUserData();
  message.success(t("personalization.unlockedSuccess"));
}

async function handleProductAction(product: GameCardProductDef) {
  productBusyId.value = product.id;
  try {
    if (isProductEquipped(product.id)) {
      await window.electronAPI.user.unequipGameCardProduct(product.id);
    } else if (isProductUnlocked(product.id)) {
      await window.electronAPI.user.equipGameCardProduct(product.id);
    } else {
      const result = await window.electronAPI.user.unlockGameCardProduct(
        product.id,
      );
      if (!result.success) {
        handleUnlockFailure(result);
        return;
      }
      message.success(t("personalization.unlockedSuccess"));
    }
    await settingsStore.loadUserData();
    await refreshProductProgress();
  } finally {
    productBusyId.value = null;
  }
}

async function saveNicknameStyle() {
  if (!canSaveNicknameStyle.value) {
    message.warning(t("personalization.nicknameColorContrastWarning"));
    return;
  }
  const result = await window.electronAPI.settings.saveNicknameStyle({
    ...nicknameStyleForm.value,
  });
  if (!result.success) {
    if (result.code === "insufficient_coins") {
      message.error(
        t("personalization.nicknameStyleInsufficientCoins", {
          coins: NICKNAME_STYLE_SAVE_COST,
        }),
      );
    } else {
      message.error(t("settings.saveFail"));
    }
    return;
  }
  await settingsStore.loadSettings();
  await settingsStore.loadUserData();
  syncNicknameStyleForm();
  message.success(
    t("personalization.nicknameStyleSaved", {
      coins: NICKNAME_STYLE_SAVE_COST,
    }),
  );
}

async function resetNicknameStyle() {
  nicknameStyleForm.value = { ...DEFAULT_NICKNAME_STYLE };
  await saveNicknameStyle();
}

onMounted(async () => {
  await settingsStore.loadSettings();
  await settingsStore.loadUserData();
  await refreshProductProgress();
  syncNicknameStyleForm();
});

watch(
  () => settingsStore.effectiveTheme,
  () => {
    nicknameStyleForm.value =
      adaptNicknameStyleForTheme(
        nicknameStyleForm.value,
        settingsStore.effectiveTheme,
      ) || nicknameStyleForm.value;
  },
);
</script>

<style scoped>
.frame-card {
  border-radius: 12px;
  background: var(--bz-bg-panel);
  border: 2px solid transparent;
  transition: all 0.25s;
  overflow: hidden;
}

.frame-card:hover {
  border-color: var(--bz-border-hover);
}

.frame-card.frame-equipped {
  border-color: var(--bz-green);
}

.frame-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 12px;
  background: var(--bz-bg-subtle);
  cursor: pointer;
  transition: background 0.25s;
}

.frame-preview:hover {
  background: var(--bz-bg-hover);
}

.frame-preview-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bz-green);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.frame-body {
  padding: 12px 16px 16px;
}

.frame-title {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 6px;
}

.frame-condition {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--bz-text-hint);
  margin-bottom: 12px;
}

.frame-actions {
  display: flex;
  gap: 8px;
}

.game-card-product-panel {
  padding-top: 16px;
}

.game-card-product-card {
  height: 100%;
  border: 2px solid transparent;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.game-card-product-card:hover {
  transform: translateY(-2px);
  border-color: var(--bz-border-hover);
}

.game-card-product-equipped {
  border-color: var(--bz-green);
}

.game-card-product-previews {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  gap: 8px;
  margin-bottom: 14px;
}

.game-card-product-preview {
  position: relative;
  align-self: start;
  overflow: visible;
  border-radius: 10px;
  background: transparent;
}

.game-card-product-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.wide-preview {
  align-self: start;
}

.preview-ratio {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.48);
  color: #fff;
  font-size: 10px;
  line-height: 1.2;
}

.game-card-product-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.game-card-product-title {
  min-width: 0;
  color: var(--bz-text-title);
  font-size: 16px;
  font-weight: 700;
}

.game-card-product-description {
  display: block;
  min-height: 40px;
  font-size: 12px;
  line-height: 1.6;
}

.game-card-product-condition {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 6px;
  min-height: 42px;
  margin: 12px 0;
  color: var(--bz-text-hint);
  font-size: 12px;
  line-height: 1.5;
}

.game-card-product-progress {
  width: 100%;
  padding-left: 21px;
  color: var(--bz-text-tertiary);
}

.nickname-style-panel {
  display: grid;
  grid-template-columns: minmax(min(100%, 18rem), 0.85fr) minmax(
      min(100%, 24rem),
      1.55fr
    );
  gap: clamp(12px, 2vw, 20px);
  padding-top: clamp(12px, 2vw, 18px);
  align-items: start;
}

.nickname-preview-card {
  background: var(--bz-bg-panel);
}

.nickname-preview-stage {
  display: flex;
  min-height: clamp(180px, 32vh, 280px);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(18px, 4vw, 32px);
  padding: clamp(18px, 4vw, 32px);
  text-align: center;
}

.nickname-preview-room {
  max-width: 100%;
  padding: clamp(10px, 2vw, 14px) clamp(14px, 3vw, 22px);
  border: 1px solid var(--bz-border);
  border-radius: clamp(12px, 2vw, 16px);
  background: color-mix(in srgb, var(--bz-bg-panel) 70%, transparent);
}

.nickname-style-tip {
  margin-bottom: 16px;
}

@media (max-width: 900px) {
  .nickname-style-panel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .nickname-style-panel :deep(.n-form-item) {
    grid-template-columns: 1fr;
  }

  .nickname-style-panel :deep(.n-form-item-label) {
    padding-bottom: 6px;
  }
}
</style>
