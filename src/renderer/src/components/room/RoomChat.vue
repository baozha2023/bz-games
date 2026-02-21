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
            <div class="message-content">{{ msg.content }}</div>
          </template>
        </div>
      </div>
      <n-input-group style="margin-top: 12px;">
        <n-input 
          v-model:value="inputValue" 
          :placeholder="t('chat.placeholder')" 
          @keydown.enter="handleSend"
        />
        <n-button type="primary" @click="handleSend" :disabled="!inputValue.trim()">
          {{ t('chat.send') }}
        </n-button>
      </n-input-group>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { NCard, NInput, NInputGroup, NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRoomStore } from '../../stores/useRoomStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

const { t } = useI18n()
const roomStore = useRoomStore()
const settingsStore = useSettingsStore()
const inputValue = ref('')
const scrollContainer = ref<HTMLElement | null>(null)

const handleSend = async () => {
  if (!inputValue.value.trim()) return;
  await roomStore.sendChatMessage(inputValue.value);
  inputValue.value = '';
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
</style>
