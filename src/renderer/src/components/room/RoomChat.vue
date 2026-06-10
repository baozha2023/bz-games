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
      <ChatMessageList
        :messages="roomStore.chatMessages"
        :player-id="settingsStore.settings?.playerId || ''"
        :playing-audio-id="playingAudioId"
        :sensitive-word-filter="settingsStore.settings?.sensitiveWordFilter !== false"
        :sensitive-words="sensitiveWords"
        rounded
        @open-image="openImageViewer"
        @play-audio="playAudio"
      />
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
import { ref, onMounted } from 'vue'
import { NCard, NInput, NInputGroup, NButton, NIcon, useMessage } from 'naive-ui'
import { Mic, Expand } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useRoomStore } from '../../stores/useRoomStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import ImageViewer from './ImageViewer.vue'
import ChatMessageList from './ChatMessageList.vue'

const { t } = useI18n()
const roomStore = useRoomStore()
const settingsStore = useSettingsStore()

defineEmits<{
  popOut: []
}>()
const message = useMessage()
const inputValue = ref('')
const isRecording = ref(false)
const playingAudioId = ref<string | null>(null)
const viewerShow = ref(false)
const viewerSrc = ref('')
const sensitiveWords = ref<string[]>([])

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingTimer: ReturnType<typeof setTimeout> | null = null;
let currentAudio: HTMLAudioElement | null = null;

onMounted(async () => {
  try {
    sensitiveWords.value = await window.electronAPI.settings.getSensitiveWords()
  } catch {
    sensitiveWords.value = []
  }
})

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

function openImageViewer(src: string) {
  viewerSrc.value = src
  viewerShow.value = true
}
</script>

<style scoped>
.room-chat {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.mic-btn {
  width: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
