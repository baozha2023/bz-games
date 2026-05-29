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
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/useSettingsStore'
import { TimeOutline, CalendarOutline, TodayOutline, WalletOutline } from '@vicons/ionicons5'
import AvatarWithFrame from '../components/AvatarWithFrame.vue'
import type { AvatarFrameDef } from '../../../shared/types'
import { AVATAR_FRAMES } from '../../../shared/avatar-frames'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const activeTab = ref('avatarFrame')
const frames = ref<AvatarFrameDef[]>(AVATAR_FRAMES)

const userData = computed(() => settingsStore.userData)
const equippedFrame = computed(() => userData.value?.equippedFrame)

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

onMounted(async () => {
  await settingsStore.loadUserData()
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
</style>
