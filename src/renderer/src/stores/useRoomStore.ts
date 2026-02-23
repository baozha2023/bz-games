import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RoomInfo, RoomEvent, PlayerInRoom, ChatPayload } from '../../../shared/types';
import { useSettingsStore } from './useSettingsStore';

export const useRoomStore = defineStore('room', () => {
  const { t } = useI18n();
  const settingsStore = useSettingsStore()
  const room = ref<RoomInfo | null>(null);
  const isConnecting = ref(false);
  const chatMessages = ref<ChatPayload[]>([]);

  const localPlayerId = computed(() => settingsStore.settings?.playerId || '');
  const isHost = computed(() => room.value?.hostId === localPlayerId.value);
  const localPlayer = computed(() => room.value?.players.find(p => p.id === localPlayerId.value));
  const allReady = computed(() => room.value?.players.every(p => p.isReady || p.isHost));

  async function createRoom(gameId: string, version?: string) {
    if (room.value) {
      throw new Error('ALREADY_IN_ROOM');
    }
    const { port } = await window.electronAPI.room.create(gameId, version);
    room.value = await window.electronAPI.room.getState();
    chatMessages.value = [];
    return port;
  }

  async function joinRoom(gameId: string, address: string, version?: string) {
    isConnecting.value = true;
    try {
      const res = await window.electronAPI.room.join(gameId, address, version);
      if (res.success) {
        // Wait a bit for sync event or manually get state
        const state = await window.electronAPI.room.getState();
        if (state) {
          room.value = state;
        }
        chatMessages.value = [];
      }
      return res;
    } finally {
      isConnecting.value = false;
    }
  }

  async function leaveRoom() {
    await window.electronAPI.room.leave();
    room.value = null;
    chatMessages.value = [];
  }

  async function setReady(ready: boolean) {
    if (ready) await window.electronAPI.room.ready();
    else await window.electronAPI.room.unready();
  }

  async function startGame() {
    await window.electronAPI.room.start();
  }
  
  async function sendChatMessage(content: string, type: 'text' | 'audio' = 'text') {
    if (!content.trim() && type === 'text') return;
    if (!room.value) return;
    await window.electronAPI.room.sendChat(content, type);
  }

  function handleRoomEvent(event: RoomEvent) {
    if (event.type === 'room:state:sync') {
      room.value = event.payload as RoomInfo;
    } else if (event.type === 'room:chat') {
      chatMessages.value.push(event.payload as ChatPayload);
    } else if (event.type === 'room:player:joined') {
      const payload = event.payload as PlayerInRoom;
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        content: t('room.playerJoined', { name: payload.name }),
        timestamp: Date.now(),
        isSystem: true
      });
      // Update room players list
      if (room.value) {
        const exists = room.value.players.some(p => p.id === payload.id);
        if (!exists) {
          room.value.players.push(payload);
        }
      }
    } else if (event.type === 'room:player:left') {
      const payload = event.payload as { playerId: string };
      const p = room.value?.players.find(p => p.id === payload.playerId);
      const name = p ? p.name : 'Unknown';
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        content: t('room.playerLeft', { name: name }),
        timestamp: Date.now(),
        isSystem: true
      });
      
      // Update local state manually since server didn't sync?
      if (room.value) {
        room.value.players = room.value.players.filter(p => p.id !== payload.playerId);
      }
    } else if (event.type === 'room:disbanded') {
      room.value = null;
      chatMessages.value = [];
    } else if (event.type === 'room:game:start') {
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        content: t('room.gameStarted'),
        timestamp: Date.now(),
        isSystem: true
      });
    } else if (event.type === 'room:game:end') {
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        content: t('room.gameEnded'),
        timestamp: Date.now(),
        isSystem: true
      });
    }
  }

  return { 
    room, isConnecting, localPlayerId, isHost, localPlayer, allReady, chatMessages,
    createRoom, joinRoom, leaveRoom, setReady, startGame, handleRoomEvent, sendChatMessage
  };
});
