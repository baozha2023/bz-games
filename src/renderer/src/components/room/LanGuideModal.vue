<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('room.lanGuideTitle')"
    style="width: 72vw; max-width: calc(100vw - 32px);"
    :bordered="false"
  >
    <div ref="contentRef" class="lan-guide-modal" tabindex="-1">
      <n-alert type="info" class="lan-guide-overview">
        {{ t('room.lanGuideOverview') }}
      </n-alert>

      <div class="lan-guide-grid">
        <n-card size="small" embedded class="lan-guide-card">
          <div class="lan-guide-card-header">
            <div>
              <div class="lan-guide-card-title">{{ t('room.lanGuideNatfrpTitle') }}</div>
              <div class="lan-guide-card-subtitle">{{ t('room.lanGuideNatfrpSummary') }}</div>
            </div>
            <n-button size="tiny" @click="handleOpenUrl(NATFRP_URL)">
              {{ t('room.lanGuideOpenSite') }}
            </n-button>
          </div>
          <div class="lan-guide-url-row">
            <span class="lan-guide-url-label">{{ t('room.lanGuideSiteLabel') }}</span>
            <span class="lan-guide-url">{{ NATFRP_URL }}</span>
          </div>
          <div class="lan-guide-section-title">{{ t('room.lanGuideRecommendedConfig') }}</div>
          <ol class="lan-guide-steps">
            <li>{{ t('room.lanGuideNatfrpStep1') }}</li>
            <li>{{ t('room.lanGuideNatfrpStep2') }}</li>
            <li>{{ t('room.lanGuideNatfrpStep3') }}</li>
            <li>{{ t('room.lanGuideNatfrpStep4') }}</li>
            <li>{{ t('room.lanGuideNatfrpStep5') }}</li>
          </ol>
        </n-card>

        <n-card size="small" embedded class="lan-guide-card">
          <div class="lan-guide-card-header">
            <div>
              <div class="lan-guide-card-title">{{ t('room.lanGuideEasyTierTitle') }}</div>
              <div class="lan-guide-card-subtitle">{{ t('room.lanGuideEasyTierSummary') }}</div>
            </div>
            <n-button size="tiny" @click="handleOpenUrl(EASYTIER_URL)">
              {{ t('room.lanGuideOpenSite') }}
            </n-button>
          </div>
          <div class="lan-guide-url-row">
            <span class="lan-guide-url-label">{{ t('room.lanGuideSiteLabel') }}</span>
            <span class="lan-guide-url">{{ EASYTIER_URL }}</span>
          </div>
          <div class="lan-guide-section-title">{{ t('room.lanGuideRecommendedConfig') }}</div>
          <ol class="lan-guide-steps">
            <li>{{ t('room.lanGuideEasyTierStep1') }}</li>
            <li>{{ t('room.lanGuideEasyTierStep2') }}</li>
            <li>{{ t('room.lanGuideEasyTierStep3') }}</li>
            <li>{{ t('room.lanGuideEasyTierStep4') }}</li>
            <li>{{ t('room.lanGuideEasyTierStep5') }}</li>
          </ol>
        </n-card>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'

const NATFRP_URL = 'https://www.natfrp.com/'
const EASYTIER_URL = 'https://easytier.cn/'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const show = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val),
})

const { t } = useI18n()
const message = useMessage()
const contentRef = ref<HTMLElement | null>(null)

watch(show, async (visible) => {
  if (!visible) return
  await nextTick()
  contentRef.value?.focus()
})

const handleOpenUrl = async (url: string) => {
  const ok = await window.electronAPI.settings.openUrl(url)
  if (!ok) {
    message.error(t('common.error'))
  }
}
</script>

<style scoped>
.lan-guide-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 80vh;
  overflow-y: auto;
  padding-right: 4px;
  outline: none;
}

.lan-guide-overview {
  margin-bottom: 0;
}

.lan-guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.lan-guide-card {
  height: 100%;
}

.lan-guide-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.lan-guide-card-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.lan-guide-card-subtitle {
  margin-top: 4px;
  color: var(--n-text-color-3);
  font-size: 13px;
  line-height: 1.5;
}

.lan-guide-url-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.6;
}

.lan-guide-url-label {
  flex-shrink: 0;
  color: var(--n-text-color-3);
}

.lan-guide-url {
  word-break: break-all;
  font-family: Consolas, 'Courier New', monospace;
}

.lan-guide-section-title {
  margin: 12px 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.lan-guide-steps {
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
}
</style>
