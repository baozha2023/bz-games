<template>
  <div class="chat-messages" :class="{ rounded }" ref="scrollContainer">
    <div v-if="messages.length === 0" class="no-message">
      {{ t('chat.noMessage') }}
    </div>
    <div
      v-else
      v-for="msg in messages"
      :key="msg.id"
      class="message-item"
      :class="{ system: msg.isSystem }"
    >
      <template v-if="msg.isSystem">
        <GameReportCard v-if="msg.contentType === 'game_report'" :msg="msg" />
        <span v-else class="system-text">{{ msg.content }}</span>
      </template>
      <template v-else>
        <div class="message-header">
          <span class="sender" :class="{ 'is-me': msg.senderId === playerId }">{{ msg.senderName }}</span>
          <span class="time">{{ formatTime(msg.timestamp) }}</span>
        </div>
        <div class="message-content">
          <div v-if="msg.images && msg.images.length > 0" class="message-images">
            <img
              v-for="(imgSrc, idx) in msg.images"
              :key="idx"
              :src="imgSrc"
              class="chat-image"
              @click="$emit('openImage', imgSrc)"
            />
          </div>
          <div v-if="isImageContent(msg) && (!msg.images || msg.images.length === 0)">
            <img
              :src="msg.content"
              class="chat-image"
              @click="$emit('openImage', msg.content)"
            />
          </div>
          <div v-if="msg.content && !isAudioOrImageContent(msg)" class="message-text">{{ displayText(msg.content) }}</div>
          <div v-if="msg.contentType === 'audio' || (msg.content && msg.content.startsWith('data:audio/'))">
            <div class="audio-msg" @click="$emit('playAudio', msg.id, msg.content)">
              <n-icon size="16"><MusicalNote /></n-icon>
              <span v-if="playingAudioId === msg.id" class="playing-text">{{ t('chat.playing') }}<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>
              <span v-else>{{ t('chat.audioMsg') }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { NIcon } from 'naive-ui'
import { MusicalNote } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type { ChatPayload } from '../../../../shared/types'
import GameReportCard from './GameReportCard.vue'
import { filterSensitiveText } from '../../utils/sensitiveWordFilter'

const props = withDefaults(defineProps<{
  messages: ChatPayload[]
  playerId?: string
  playingAudioId?: string | null
  sensitiveWordFilter?: boolean
  sensitiveWords?: string[]
  rounded?: boolean
}>(), {
  playerId: '',
  playingAudioId: null,
  sensitiveWordFilter: true,
  sensitiveWords: () => [],
  rounded: false,
})

defineEmits<{
  openImage: [src: string]
  playAudio: [msgId: string, dataUrl: string]
}>()

const { t } = useI18n()
const scrollContainer = ref<HTMLElement | null>(null)

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isImageContent(msg: ChatPayload): boolean {
  if (msg.contentType === 'image') return true
  if (msg.content && msg.content.startsWith('data:image/')) return true
  return false
}

function isAudioOrImageContent(msg: ChatPayload): boolean {
  if (isImageContent(msg)) return true
  if (msg.contentType === 'audio') return true
  if (msg.content && msg.content.startsWith('data:audio/')) return true
  return false
}

function displayText(content: string): string {
  if (!props.sensitiveWordFilter) return content
  return filterSensitiveText(content, props.sensitiveWords)
}

watch(
  () => props.messages.length,
  () => {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      }
    })
  },
)
</script>

<style scoped>
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  background: var(--bz-bg-subtle);
}

.chat-messages.rounded {
  min-height: 0;
  border-radius: 4px;
}

.no-message {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bz-chat-text-system);
}

.message-item {
  margin-bottom: 8px;
  font-size: 13px;
}

.message-item.system {
  text-align: center;
  color: var(--bz-chat-text-system);
  font-size: 12px;
  margin: 12px 0;
}

.message-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 2px;
}

.sender {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #333;
}

.sender.is-me {
  color: #389e0d;
}

.time {
  color: var(--bz-chat-text-system);
  font-size: 11px;
}

.message-content {
  word-break: break-word;
  white-space: pre-wrap;
  color: var(--bz-text-title);
}

.message-text {
  white-space: pre-wrap;
}

.message-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.chat-image {
  max-width: 240px;
  max-height: 200px;
  object-fit: contain;
  border-radius: 6px;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='10' cy='10' r='6.5' fill='none' stroke='%23222' stroke-width='1.8' opacity='.9'/%3E%3Cline x1='14.6' y1='14.6' x2='21' y2='21' stroke='%23222' stroke-width='2' stroke-linecap='round' opacity='.9'/%3E%3Cpath d='M7 10h6M10 7v6' fill='none' stroke='%23222' stroke-width='1.8' stroke-linecap='round' opacity='.9'/%3E%3C/svg%3E") 12 12, pointer;
  display: block;
  transition: filter 0.15s;
}

.audio-msg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: var(--bz-bg-chat-bubble);
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.audio-msg:hover {
  background: var(--bz-bg-chat-bubble-hover);
}

.playing-text {
  color: var(--bz-green);
}

.dot {
  animation: dot-blink 1.4s infinite;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-blink {
  0%, 20% { opacity: 0; }
  50%, 100% { opacity: 1; }
}
</style>
