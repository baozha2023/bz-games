<template>
  <div class="room-chat">
    <n-card size="small" style="height: 100%; display: flex; flex-direction: column;" :content-style="{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }">
      <template #header>
        <span>{{ t('chat.title') }}</span>
      </template>
      <template #header-extra>
        <n-button text @click="$emit('popOut')" :title="t('chat.popOut')">
          <template #icon>
            <n-icon size="18"><Expand /></n-icon>
          </template>
        </n-button>
      </template>
      <div class="chat-messages" ref="scrollContainer">
        <div v-if="roomStore.chatMessages.length === 0" class="no-message">
          {{ t('chat.noMessage') }}
        </div>
        <div v-else v-for="msg in roomStore.chatMessages" :key="msg.id" class="message-item" :class="{ 'system': msg.isSystem }">
          <template v-if="msg.isSystem">
            <GameReportCard v-if="msg.contentType === 'game_report'" :msg="msg" />
            <span v-else class="system-text">{{ msg.content }}</span>
          </template>
          <template v-else>
            <div class="message-header">
              <span class="sender" :class="{ 'is-me': msg.senderId === settingsStore.settings?.playerId }">{{ msg.senderName }}</span>
              <span class="time">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="message-content">
              <div v-if="msg.images && msg.images.length > 0" class="message-images">
                <img
                  v-for="(imgSrc, idx) in msg.images"
                  :key="idx"
                  :src="imgSrc"
                  class="chat-image"
                  @click="openImageViewer(imgSrc)"
                />
              </div>
              <div v-if="isImageContent(msg) && (!msg.images || msg.images.length === 0)">
                <img
                  :src="msg.content"
                  class="chat-image"
                  @click="openImageViewer(msg.content)"
                />
              </div>
              <div v-if="msg.content && !isAudioOrImageContent(msg)" class="message-text">{{ msg.content }}</div>
              <div v-if="msg.contentType === 'audio' || (msg.content && msg.content.startsWith('data:audio/'))">
                <div class="audio-msg" @click="playAudio(msg.id, msg.content)">
                  <n-icon size="16"><MusicalNote /></n-icon>
                  <span v-if="playingAudioId === msg.id" class="playing-text">{{ t('chat.playing') }}<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>
                  <span v-else>{{ t('chat.audioMsg') }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
      <n-input-group style="margin-top: 12px; flex-shrink: 0;">
        <n-button 
          :type="isRecording ? 'error' : 'default'"
          @mousedown="startRecording" 
          @mouseup="stopRecording"
          @mouseleave="cancelRecording"
          class="mic-btn"
        >
          <template #icon>
            <n-icon><Mic /></n-icon>
          </template>
        </n-button>
        <n-input 
          v-model:value="inputValue" 
          :placeholder="isRecording ? t('chat.recording') : t('chat.placeholder')" 
          @keydown.enter="handleSend"
          :disabled="isRecording"
        />
        <n-button type="primary" @click="handleSend" :disabled="!inputValue.trim() || isRecording">
          {{ t('chat.send') }}
        </n-button>
      </n-input-group>
    </n-card>
    <ImageViewer :show="viewerShow" :src="viewerSrc" @close="viewerShow = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { NCard, NInput, NInputGroup, NButton, NIcon, useMessage } from 'naive-ui'
import { Mic, MusicalNote, Expand } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useRoomStore } from '../../stores/useRoomStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import ImageViewer from './ImageViewer.vue'
import GameReportCard from './GameReportCard.vue'
import type { ChatPayload } from '../../../../shared/types'

const { t } = useI18n()
const roomStore = useRoomStore()
const settingsStore = useSettingsStore()

defineEmits<{
  popOut: []
}>()
const message = useMessage()
const inputValue = ref('')
const scrollContainer = ref<HTMLElement | null>(null)
const isRecording = ref(false)
const playingAudioId = ref<string | null>(null)
const viewerShow = ref(false)
const viewerSrc = ref('')

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingTimer: ReturnType<typeof setTimeout> | null = null;
let currentAudio: HTMLAudioElement | null = null;

const handleSend = async () => {
  if (!inputValue.value.trim()) return;
  await roomStore.sendChatMessage(inputValue.value);
  inputValue.value = '';
}

const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000 } });
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 32000,
    });
    audioChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = async () => {
      // Only process if we have chunks and wasn't cancelled (checked via isRecording flag logic if needed, 
      // but here we rely on the stop event. If we want to cancel, we might need a flag)
      if (audioChunks.length > 0) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        
        // Simple validation: if too short, ignore
        if (audioBlob.size < 1000) { // < 1KB is probably noise or instant click
            message.warning(t('chat.tooShort'));
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          roomStore.sendChatMessage(base64, 'audio');
        };
        reader.readAsDataURL(audioBlob);
      }
      
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start();
    isRecording.value = true;

    // 10s limit
    recordingTimer = setTimeout(() => {
      stopRecording();
      message.warning(t('chat.recordingTooLong'));
    }, 10000);
  } catch (err) {
    console.error('Error accessing microphone:', err);
    message.error(t('chat.micError'));
  }
};

const stopRecording = () => {
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    isRecording.value = false;
  }
};

const cancelRecording = () => {
    // If mouse leaves, we treat it as stop or cancel? 
    // WeChat cancels if you drag out. But for simplicity, let's just stop and send.
    // If we want to cancel, we would clear audioChunks.
    stopRecording();
}

const playAudio = (msgId: string, dataUrl: string) => {
  if (playingAudioId.value) {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    playingAudioId.value = null
    return
  }
  playingAudioId.value = msgId
  const audio = new Audio(dataUrl)
  currentAudio = audio
  audio.onended = () => {
    playingAudioId.value = null
    currentAudio = null
  }
  audio.play().catch(e => {
    console.error('Failed to play audio', e)
    message.error(t('chat.playError'))
    playingAudioId.value = null
    currentAudio = null
  })
}

const formatTime = (ts: number) => {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

function openImageViewer(src: string) {
  viewerSrc.value = src
  viewerShow.value = true
}

watch(() => roomStore.chatMessages.length, () => {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    }
  })
})
</script>

<style scoped>
.room-chat {
  height: 100%;
  min-height: 320px;
}
.chat-messages {
  flex: 1;
  min-height: 220px;
  overflow-y: auto;
  padding: 8px;
  background: var(--bz-bg-subtle);
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
.mic-btn {
  width: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
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
