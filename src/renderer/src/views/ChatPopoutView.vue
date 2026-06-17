<template>
  <div class="chat-popout" @dragover.prevent="handleDragOver" @dragleave="handleDragLeave" @drop.prevent="handleDrop">
    <div class="chat-header">
      <span class="chat-title">{{ t('chat.title') }} - {{ roomName }}</span>
      <n-button text @click="handlePopIn" :title="t('chat.popIn')">
        <template #icon>
          <n-icon size="18"><Contract /></n-icon>
        </template>
      </n-button>
    </div>
    <ChatMessageList
      :messages="chatMessages"
      :player-id="playerId"
      :playing-audio-id="playingAudioId"
      :sensitive-word-filter="sensitiveWordFilter"
      :sensitive-words="sensitiveWords"
      @open-image="openImageViewer"
      @play-audio="playAudio"
    />
    <div
      class="chat-resize-handle"
      @mousedown="startResize"
    />
    <div
      class="chat-input-area"
      :style="{ height: inputHeight + 'px' }"
      :class="{ 'drag-over': isDragOver }"
    >
      <div v-if="pendingImages.length > 0" class="chat-image-preview">
        <div v-for="img in pendingImages" :key="img.id" class="preview-item">
          <img :src="img.dataUrl" class="preview-thumb" @click="openImageViewer(img.dataUrl)" />
          <n-button text size="tiny" class="preview-remove" @click="removePendingImage(img.id)">
            <template #icon>
              <n-icon size="14"><CloseCircle /></n-icon>
            </template>
          </n-button>
        </div>
      </div>
      <textarea
        ref="textareaRef"
        v-model="inputValue"
        class="chat-textarea"
        :placeholder="isRecording ? t('chat.recording') : (isDragOver ? t('chat.dropHere') : t('chat.placeholder'))"
        :disabled="isRecording"
        @keydown.enter="handleKeyDown"
        @paste="handlePaste"
      />
      <div class="chat-input-actions">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="handleFileInputChange"
        />
        <n-button
          size="small"
          quaternary
          :title="t('chat.importImage')"
          @click="handleImportImage"
          :disabled="isRecording || isRelayRoom"
        >
          <template #icon>
            <n-icon><Image /></n-icon>
          </template>
        </n-button>
        <n-button
          :type="isRecording ? 'error' : 'default'"
          @mousedown="startRecording"
          @mouseup="stopRecording"
          @mouseleave="cancelRecording"
          size="small"
          quaternary
        >
          <template #icon>
            <n-icon><Mic /></n-icon>
          </template>
        </n-button>
        <n-button type="primary" @click="handleSend" :disabled="(!inputValue.trim() && pendingImages.length === 0) || isRecording" size="small">
          {{ t('chat.send') }}
        </n-button>
      </div>
    </div>
    <ImageViewer :show="viewerShow" :src="viewerSrc" @close="viewerShow = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { NButton, NIcon, useMessage } from 'naive-ui'
import { Mic, Contract, CloseCircle, Image } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type { ChatPayload, RoomEvent } from '../../../shared/types'
import ImageViewer from '../components/room/ImageViewer.vue'
import ChatMessageList from '../components/room/ChatMessageList.vue'

const { t } = useI18n()
const message = useMessage()

const chatMessages = ref<ChatPayload[]>([])
const inputValue = ref('')
const isRecording = ref(false)
const playingAudioId = ref<string | null>(null)
const playerId = ref('')
const roomName = ref('')
const isRelayRoom = ref(false)

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let recordingTimer: ReturnType<typeof setTimeout> | null = null
let currentAudio: HTMLAudioElement | null = null
let cleanupEvent: (() => void) | undefined

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const inputHeight = ref(204)
const MIN_INPUT_HEIGHT = 60
const MAX_INPUT_HEIGHT = 260

const pendingImages = ref<{ id: string; dataUrl: string }[]>([])
const isDragOver = ref(false)
const viewerShow = ref(false)
const viewerSrc = ref('')
const sensitiveWordFilter = ref(true)
const sensitiveWords = ref<string[]>([])
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function startResize(event: MouseEvent) {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = inputHeight.value

  function onMouseMove(e: MouseEvent) {
    const delta = startY - e.clientY
    const newHeight = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, startHeight + delta))
    inputHeight.value = newHeight
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.electronAPI.settings.savePartialSettings({ chatInputHeight: inputHeight.value }).catch(() => {})
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

const handleSend = async () => {
  const hasText = inputValue.value.trim().length > 0
  const hasImages = !isRelayRoom.value && pendingImages.value.length > 0
  if (!hasText && !hasImages) return

  try {
    const text = hasText ? inputValue.value : ''
    const imgs = hasImages ? pendingImages.value.map((i) => i.dataUrl) : undefined
    await window.electronAPI.room.sendChat(text, undefined, imgs)
    inputValue.value = ''
    pendingImages.value = []
  } catch {
    message.error(t('chat.sendFailed'))
  }
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

const handlePopIn = async () => {
  try {
    await window.electronAPI.room.popInChat()
  } catch {
    // ignore
  }
}

const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000 } })
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 32000,
    })
    audioChunks = []

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data)
    }

    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
        if (audioBlob.size < 1000) {
          message.warning(t('chat.tooShort'))
          return
        }
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = reader.result as string
          window.electronAPI.room.sendChat(base64, 'audio')
        }
        reader.readAsDataURL(audioBlob)
      }
      stream.getTracks().forEach((track) => track.stop())
    }

    mediaRecorder.start()
    isRecording.value = true

    recordingTimer = setTimeout(() => {
      stopRecording()
      message.warning(t('chat.recordingTooLong'))
    }, 10000)
  } catch (err) {
    console.error('Error accessing microphone:', err)
    message.error(t('chat.micError'))
  }
}

const stopRecording = () => {
  if (recordingTimer) {
    clearTimeout(recordingTimer)
    recordingTimer = null
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
    isRecording.value = false
  }
}

const cancelRecording = () => {
  stopRecording()
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
  audio.play().catch((e) => {
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

function addImageFromFile(file: File) {
  if (isRelayRoom.value) return
  if (!file.type.startsWith('image/')) return
  if (file.size > MAX_IMAGE_SIZE) {
    message.warning(t('chat.imageTooLarge'))
    return
  }
  const reader = new FileReader()
  reader.onloadend = () => {
    pendingImages.value.push({
      id: crypto.randomUUID(),
      dataUrl: reader.result as string,
    })
  }
  reader.readAsDataURL(file)
}

function removePendingImage(id: string) {
  pendingImages.value = pendingImages.value.filter((img) => img.id !== id)
}

function handlePaste(e: ClipboardEvent) {
  if (isRelayRoom.value) return
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) addImageFromFile(file)
    }
  }
}

function handleDragOver() {
  if (isRelayRoom.value) return
  isDragOver.value = true
}
function handleDragLeave() {
  isDragOver.value = false
}
function handleDrop(e: DragEvent) {
  isDragOver.value = false
  if (isRelayRoom.value) return
  const files = e.dataTransfer?.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    addImageFromFile(files[i])
  }
}

function handleImportImage() {
  if (isRelayRoom.value) return
  fileInputRef.value?.click()
}

function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    addImageFromFile(files[i])
  }
  input.value = ''
}

const handleRoomEvent = (event: RoomEvent) => {
  if (event.type === 'room:chat') {
    chatMessages.value.push(event.payload as ChatPayload)
  } else if (event.type === 'room:chat:history:sync') {
    chatMessages.value = event.payload as ChatPayload[]
  } else if (event.type === 'room:state:sync') {
    updateRoomState(event.payload)
  } else if (event.type === 'room:disbanded' || event.type === 'room:kicked') {
    chatMessages.value = []
  }
}

function updateRoomState(state: unknown) {
  const room = state as { gameId?: string; hostConnectionMode?: string } | null
  roomName.value = room?.gameId || ''
  isRelayRoom.value = room?.hostConnectionMode === 'relay'
  if (isRelayRoom.value) {
    pendingImages.value = []
    isDragOver.value = false
  }
}

onMounted(async () => {
  if (window.electronAPI?.room?.onEvent) {
    cleanupEvent = window.electronAPI.room.onEvent(handleRoomEvent)
  }

  try {
    const history = await window.electronAPI.room.getChatHistory()
    if (history && Array.isArray(history) && history.length > 0) {
      chatMessages.value = history as ChatPayload[]
    }
  } catch {
    // ignore
  }

  try {
    const state = await window.electronAPI.room.getState()
    if (state) {
      updateRoomState(state)
    }
  } catch {
    // ignore
  }

  try {
    const settings = await window.electronAPI.settings.get()
    if (settings) {
      playerId.value = settings.playerId || ''
      sensitiveWordFilter.value = settings.sensitiveWordFilter !== false
      if (settings.chatInputHeight) {
        inputHeight.value = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, settings.chatInputHeight))
      }
    }
  } catch {
    // ignore
  }

  try {
    sensitiveWords.value = await window.electronAPI.settings.getSensitiveWords()
  } catch {
    sensitiveWords.value = []
  }
})

onUnmounted(() => {
  if (cleanupEvent) cleanupEvent()
})
</script>

<style scoped>
.chat-popout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bz-bg);
  overflow: hidden;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--bz-border);
  background: var(--bz-bg-panel);
  -webkit-app-region: drag;
}

.chat-header .n-button {
  -webkit-app-region: no-drag;
}

.chat-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--bz-text-title);
}

.chat-resize-handle {
  height: 5px;
  cursor: ns-resize;
  background: var(--bz-border);
  flex-shrink: 0;
  transition: background 0.2s;
}

.chat-resize-handle:hover {
  background: var(--bz-info-blue);
}

.chat-input-area {
  position: relative;
  min-height: 60px;
  border-top: 1px solid var(--bz-border);
  background: var(--bz-bg-panel);
  flex-shrink: 0;
}

.chat-textarea {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--bz-text-title);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  padding: 8px 110px 8px 8px;
  box-sizing: border-box;
}

.chat-textarea::placeholder {
  color: var(--bz-chat-text-system);
}

.chat-textarea:disabled {
  opacity: 0.5;
}

.chat-input-actions {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  gap: 4px;
  pointer-events: auto;
}

.chat-image-preview {
  display: flex;
  gap: 6px;
  padding: 6px 8px 0;
  flex-wrap: wrap;
}

.preview-item {
  position: relative;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}

.preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Ccircle cx='10' cy='10' r='6.5' fill='none' stroke='%23222' stroke-width='1.8' opacity='.9'/%3E%3Cline x1='14.6' y1='14.6' x2='21' y2='21' stroke='%23222' stroke-width='2' stroke-linecap='round' opacity='.9'/%3E%3Cpath d='M7 10h6M10 7v6' fill='none' stroke='%23222' stroke-width='1.8' stroke-linecap='round' opacity='.9'/%3E%3C/svg%3E") 12 12, pointer;
  border: 1px solid var(--bz-border);
}

.preview-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  opacity: 0;
  transition: opacity 0.2s;
}

.preview-item:hover .preview-remove {
  opacity: 1;
}

.chat-input-area.drag-over {
  background: var(--bz-bg-chat-bubble);
}
</style>
