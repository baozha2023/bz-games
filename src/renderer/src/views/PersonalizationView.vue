<template>
  <div style="padding: 24px;">
    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane name="avatarFrame" :tab="t('personalization.avatarFrame')">
        <div style="padding-top: 16px;">
          <n-empty
            v-if="frames.length === 0"
            :description="t('personalization.noFrames')"
            style="margin-top: 60px;"
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
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
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
                      {{ t('personalization.unequip') }}
                    </n-button>
                    <n-button
                      v-else-if="isUnlocked(frame)"
                      type="primary"
                      size="small"
                      block
                      secondary
                      @click="handleEquip(frame.id)"
                    >
                      {{ t('personalization.equip') }}
                    </n-button>
                    <n-button
                      v-else-if="frame.unlockMethod === 'bzcoin'"
                      type="warning"
                      size="small"
                      block
                      secondary
                      :disabled="(userData?.bzCoins || 0) < frame.unlockValue"
                      @click="handleBuy(frame)"
                    >
                      {{ unlockText(frame) }}
                    </n-button>
                    <n-button
                      v-else
                      size="small"
                      block
                      disabled
                      quaternary
                    >
                      {{ unlockText(frame) }}
                    </n-button>
                  </div>
                </div>
              </div>
            </n-grid-item>
          </n-grid>
        </div>
      </n-tab-pane>
      <n-tab-pane name="nicknameStyle" :tab="t('personalization.nicknameStyle')">
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
              {{ t('personalization.gradientHelp') }}
            </n-alert>
            <n-form label-placement="left" label-width="120">
              <n-form-item :label="t('personalization.nicknameColor')">
                <n-color-picker v-model:value="nicknameStyleForm.color" :show-alpha="false" />
              </n-form-item>
              <n-alert v-if="!canSaveNicknameStyle" type="warning" class="nickname-style-tip">
                {{ t('personalization.nicknameColorContrastWarning') }}
              </n-alert>
              <n-form-item :label="t('personalization.nicknameFont')">
                <n-select v-model:value="nicknameStyleForm.font" :options="fontOptions" />
              </n-form-item>
              <n-form-item :label="t('personalization.nicknameWeight')">
                <n-select v-model:value="nicknameStyleForm.weight" :options="weightOptions" />
              </n-form-item>
              <n-form-item :label="t('personalization.nicknameEffect')">
                <n-select v-model:value="nicknameStyleForm.effect" :options="effectOptions" />
              </n-form-item>
              <template v-if="supportsGradient">
                <n-form-item :label="t('personalization.gradientStart')">
                  <n-color-picker v-model:value="nicknameStyleForm.gradientStart" :show-alpha="false" />
                </n-form-item>
                <n-form-item :label="t('personalization.gradientEnd')">
                  <n-color-picker v-model:value="nicknameStyleForm.gradientEnd" :show-alpha="false" />
                </n-form-item>
              </template>
              <n-space justify="end">
                <n-button @click="resetNicknameStyle">{{ t('personalization.resetNicknameStyle') }}</n-button>
                <n-button type="primary" :disabled="!canSaveNicknameStyle" @click="saveNicknameStyle">
                  {{ t('personalization.saveNicknameStyleCost', { coins: NICKNAME_STYLE_SAVE_COST }) }}
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
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useSettingsStore } from '../stores/useSettingsStore'
import { TimeOutline, CalendarOutline, TodayOutline, WalletOutline } from '@vicons/ionicons5'
import AvatarWithFrame from '../components/AvatarWithFrame.vue'
import NicknameText from '../components/NicknameText.vue'
import { DEFAULT_NICKNAME_STYLE } from '../../../shared/types'
import type { AvatarFrameDef, NicknameEffect, NicknameFont, NicknameStyle } from '../../../shared/types'
import { AVATAR_FRAMES } from '../../../shared/avatar-frames'
import { adaptNicknameStyleForTheme, isNicknameColorAllowedForTheme } from '../utils/nicknameColor'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const message = useMessage()

const activeTab = ref('avatarFrame')
const frames = ref<AvatarFrameDef[]>(AVATAR_FRAMES)
const nicknameStyleForm = ref<NicknameStyle>({ ...DEFAULT_NICKNAME_STYLE })
const NICKNAME_STYLE_SAVE_COST = 30

const userData = computed(() => settingsStore.userData)
const equippedFrame = computed(() => userData.value?.equippedFrame)
const gradientEffects: NicknameEffect[] = ['flame', 'neon', 'aurora', 'stardust', 'crystal', 'comet']
const supportsGradient = computed(() => gradientEffects.includes(nicknameStyleForm.value.effect))
const canSaveNicknameStyle = computed(() => isNicknameColorAllowedForTheme(nicknameStyleForm.value.color, settingsStore.effectiveTheme))

const fontOptions = computed(() => ([
  { label: t('personalization.fontSystem'), value: 'system' as NicknameFont },
  { label: t('personalization.fontRounded'), value: 'rounded' as NicknameFont },
  { label: t('personalization.fontSerif'), value: 'serif' as NicknameFont },
  { label: t('personalization.fontMono'), value: 'mono' as NicknameFont },
  { label: t('personalization.fontFantasy'), value: 'fantasy' as NicknameFont },
]))

const weightOptions = computed(() => ([
  { label: t('personalization.weightNormal'), value: 'normal' },
  { label: t('personalization.weightSemibold'), value: 'semibold' },
  { label: t('personalization.weightBold'), value: 'bold' },
]))

const effectOptions = computed(() => ([
  { label: t('personalization.effectNone'), value: 'none' as NicknameEffect },
  { label: t('personalization.effectGlow'), value: 'glow' as NicknameEffect },
  { label: t('personalization.effectSparkle'), value: 'sparkle' as NicknameEffect },
  { label: t('personalization.effectFlame'), value: 'flame' as NicknameEffect },
  { label: t('personalization.effectNeon'), value: 'neon' as NicknameEffect },
  { label: t('personalization.effectRainbow'), value: 'rainbow' as NicknameEffect },
  { label: t('personalization.effectAurora'), value: 'aurora' as NicknameEffect },
  { label: t('personalization.effectStardust'), value: 'stardust' as NicknameEffect },
  { label: t('personalization.effectCrystal'), value: 'crystal' as NicknameEffect },
  { label: t('personalization.effectComet'), value: 'comet' as NicknameEffect },
  { label: t('personalization.effectHeartbeat'), value: 'heartbeat' as NicknameEffect },
]))

function syncNicknameStyleForm() {
  nicknameStyleForm.value = adaptNicknameStyleForTheme({
    ...DEFAULT_NICKNAME_STYLE,
    ...(settingsStore.settings?.nicknameStyle || {}),
  }, settingsStore.effectiveTheme) || { ...DEFAULT_NICKNAME_STYLE }
}

function isEquipped(frameId: string): boolean {
  return equippedFrame.value === frameId
}

function isUnlocked(frame: AvatarFrameDef): boolean {
  if (!userData.value) return false
  return (userData.value.ownedFrames || []).includes(frame.id)
}

function unlockText(frame: AvatarFrameDef): string {
  switch (frame.unlockMethod) {
    case 'playtime':
      return t('personalization.unlockPlaytime', { hours: Math.max(1, Math.floor(frame.unlockValue / 3600000)) })
    case 'consecutive_checkin':
      return t('personalization.unlockConsecutiveCheckIn', { days: frame.unlockValue })
    case 'total_checkin':
      return t('personalization.unlockTotalCheckIn', { days: frame.unlockValue })
    case 'bzcoin':
      return t('personalization.unlockBzCoin', { coins: frame.unlockValue })
    default:
      return ''
  }
}

function unlockIcon(frame: AvatarFrameDef) {
  switch (frame.unlockMethod) {
    case 'playtime': return TimeOutline
    case 'consecutive_checkin': return TodayOutline
    case 'total_checkin': return CalendarOutline
    case 'bzcoin': return WalletOutline
    default: return TimeOutline
  }
}

function handleEquipOrToggle(frame: AvatarFrameDef) {
  if (isEquipped(frame.id)) {
    handleUnequip(frame.id)
  } else if (isUnlocked(frame)) {
    handleEquip(frame.id)
  }
}

async function handleEquip(frameId: string) {
  await window.electronAPI.user.equipFrame(frameId)
  await settingsStore.loadUserData()
}

async function handleUnequip(frameId: string) {
  await window.electronAPI.user.unequipFrame(frameId)
  await settingsStore.loadUserData()
}

async function handleBuy(frame: AvatarFrameDef) {
  const result = await window.electronAPI.user.buyFrame(frame.id, frame.unlockValue)
  if (result.success) {
    await settingsStore.loadUserData()
  }
}

async function saveNicknameStyle() {
  if (!canSaveNicknameStyle.value) {
    message.warning(t('personalization.nicknameColorContrastWarning'))
    return
  }
  const result = await window.electronAPI.settings.saveNicknameStyle({ ...nicknameStyleForm.value })
  if (!result.success) {
    if (result.code === 'insufficient_coins') {
      message.error(t('personalization.nicknameStyleInsufficientCoins', { coins: NICKNAME_STYLE_SAVE_COST }))
    } else {
      message.error(t('settings.saveFail'))
    }
    return
  }
  await settingsStore.loadSettings()
  await settingsStore.loadUserData()
  syncNicknameStyleForm()
  message.success(t('personalization.nicknameStyleSaved', { coins: NICKNAME_STYLE_SAVE_COST }))
}

async function resetNicknameStyle() {
  nicknameStyleForm.value = { ...DEFAULT_NICKNAME_STYLE }
  await saveNicknameStyle()
}

onMounted(async () => {
  await settingsStore.loadSettings()
  await settingsStore.loadUserData()
  syncNicknameStyleForm()
})

watch(() => settingsStore.effectiveTheme, () => {
  nicknameStyleForm.value = adaptNicknameStyleForTheme(nicknameStyleForm.value, settingsStore.effectiveTheme) || nicknameStyleForm.value
})
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

.nickname-style-panel {
  display: grid;
  grid-template-columns: minmax(min(100%, 18rem), 0.85fr) minmax(min(100%, 24rem), 1.55fr);
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
