<template>
  <div class="room-chat">
    <n-card :title="t('chat.title')" size="small">
      <div class="chat-messages" ref="scrollContainer">
        <div v-if="roomStore.chatMessages.length === 0" class="no-message">
          {{ t('chat.noMessage') }}
        </div>
        <div v-else v-for="msg in roomStore.chatMessages" :key="msg.id" class="message-item" :class="{ 'system': msg.isSystem }">
          <template v-if="msg.isSystem">
            <span class="system-text">{{ msg.content }}</span>
          </template>
          <template v-else>
            <div class="message-header">
              <span class="sender" :class="{ 'is-me': msg.senderId === settingsStore.settings?.playerId }">{{ msg.senderName }}</span>
              <span class="time">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="message-content">
              <template v-if="msg.contentType === 'audio' || (msg.content && msg.content.startsWith('data:audio/'))">
                <div class="audio-msg" @click="playAudio(msg.content)">
                  <n-icon size="16"><MusicalNote /></n-icon>
                  <span>{{ t('chat.audioMsg') }}</span>
                </div>
              </template>
              <template v-else>
                {{ msg.content }}
              </template>
            </div>
          </template>
        </div>
      </div>
      <n-input-group style="margin-top: 12px;">
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
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { NCard, NInput, NInputGroup, NButton, NIcon, useMessage } from 'naive-ui'
import { Mic, MusicalNote } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useRoomStore } from '../../stores/useRoomStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

const { t } = useI18n()
const roomStore = useRoomStore()
const settingsStore = useSettingsStore()
const message = useMessage()
const inputValue = ref('')
const scrollContainer = ref<HTMLElement | null>(null)
const isRecording = ref(false)

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingTimer: ReturnType<typeof setTimeout> | null = null;

const handleSend = async () => {
  if (!inputValue.value.trim()) return;
  await roomStore.sendChatMessage(inputValue.value);
  inputValue.value = '';
}

const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
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

const playAudio = (dataUrl: string) => {
  const audio = new Audio(dataUrl);
  audio.play().catch(e => {
    console.error('Failed to play audio', e);
    message.error(t('chat.playError'));
  });
}

const formatTime = (ts: number) => {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
.chat-messages {
  height: 200px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
}
.no-message {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}
.message-item {
  margin-bottom: 8px;
  font-size: 13px;
}
.message-item.system {
  text-align: center;
  color: #999;
  font-size: 12px;
  margin: 12px 0;
}
.message-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 2px;
}
.sender {
  font-weight: bold;
  color: #2080f0;
}
.sender.is-me {
  color: #18a058;
}
.time {
  color: #999;
  font-size: 11px;
}
.message-content {
  word-break: break-word;
}
.audio-msg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: #e0e0e0;
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.2s;
}
.audio-msg:hover {
  background: #d0d0d0;
}
.mic-btn {
  width: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
