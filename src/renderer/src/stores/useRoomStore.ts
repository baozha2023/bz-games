import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  RoomInfo,
  RoomEvent,
  PlayerInRoom,
  ChatPayload,
  RoomConnectionStatus,
  RoomConnectionStatusPayload,
  RoomRelayLatencyPayload,
} from "../../../shared/types";
import { useSettingsStore } from "./useSettingsStore";

export const useRoomStore = defineStore("room", () => {
  const { t } = useI18n();
  const settingsStore = useSettingsStore();
  const room = ref<RoomInfo | null>(null);
  const isConnecting = ref(false);
  const chatMessages = ref<ChatPayload[]>([]);
  const isStartCooldown = ref(false);
  /** 是否需要重连：从 RoomInfo.reconnectPlayerIds 派生，由 RoomServer 管理 */
  const isReconnectMode = computed(() =>
    room.value?.reconnectPlayerIds?.includes(settingsStore.settings?.playerId ?? '') ?? false
  );
  const connectionStatus = ref<RoomConnectionStatus>("idle");
  const connectionReason = ref("");
  const reconnectAttempts = ref(0);
  const reconnectCountdownSec = ref(0);
  const relayLatency = ref<RoomRelayLatencyPayload | null>(null);
  let startCooldownTimer: number | null = null;
  let reconnectCountdownTimer: number | null = null;

  const localPlayerId = computed(() => settingsStore.settings?.playerId || "");
  const isHost = computed(() => room.value?.hostId === localPlayerId.value);
  const localPlayer = computed(() =>
    room.value?.players.find((p) => p.id === localPlayerId.value),
  );
  const allReady = computed(() =>
    room.value?.players.every((p) => p.isReady || p.isHost),
  );

  async function createRoom(gameId: string, version?: string) {
    if (room.value) {
      throw new Error("ALREADY_IN_ROOM");
    }
    const { port } = await window.electronAPI.room.create(gameId, version);
    room.value = await window.electronAPI.room.getState();
    chatMessages.value = [];
    relayLatency.value = null;
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
        relayLatency.value = null;
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
    isStartCooldown.value = false;
    relayLatency.value = null;
    resetConnectionStatus();
    if (startCooldownTimer) {
      window.clearTimeout(startCooldownTimer);
      startCooldownTimer = null;
    }
  }

  async function setReady(ready: boolean) {
    if (ready) await window.electronAPI.room.ready();
    else await window.electronAPI.room.unready();
  }

  async function startGame() {
    if (isStartCooldown.value) {
      throw new Error("START_COOLDOWN");
    }
    await window.electronAPI.room.start();
  }

  async function reconnectGame() {
    await window.electronAPI.room.reconnect();
  }

  async function sendChatMessage(
    content: string,
    type: "text" | "audio" | "image" = "text",
    images?: string[],
  ) {
    if (!content.trim() && type === "text" && (!images || images.length === 0)) return;
    if (!room.value) return;
    await window.electronAPI.room.sendChat(content, type, images);
  }

  async function kickPlayer(playerId: string) {
    return await window.electronAPI.room.kickPlayer(playerId);
  }

  function clearReconnectCountdown() {
    if (reconnectCountdownTimer) {
      window.clearInterval(reconnectCountdownTimer);
      reconnectCountdownTimer = null;
    }
  }

  function startReconnectCountdown(nextRetryMs: number | undefined) {
    clearReconnectCountdown();
    if (!nextRetryMs || nextRetryMs <= 0) {
      reconnectCountdownSec.value = 0;
      return;
    }
    reconnectCountdownSec.value = Math.max(1, Math.ceil(nextRetryMs / 1000));
    reconnectCountdownTimer = window.setInterval(() => {
      if (reconnectCountdownSec.value <= 1) {
        reconnectCountdownSec.value = 0;
        clearReconnectCountdown();
        return;
      }
      reconnectCountdownSec.value -= 1;
    }, 1000);
  }

  function resetConnectionStatus() {
    connectionStatus.value = "idle";
    connectionReason.value = "";
    reconnectAttempts.value = 0;
    reconnectCountdownSec.value = 0;
    relayLatency.value = null;
    clearReconnectCountdown();
  }

  function handleRoomEvent(event: RoomEvent) {
    if (event.type === "room:state:sync") {
      const prevState = room.value?.state;
      room.value = event.payload as RoomInfo;
      if (prevState === "playing" && room.value?.state === "waiting") {
        chatMessages.value.push({
          id: window.crypto.randomUUID(),
          senderId: "system",
          senderName: "System",
          content: t("room.gameEnded"),
          timestamp: Date.now(),
          isSystem: true,
        });
        isStartCooldown.value = true;
        if (startCooldownTimer) {
          window.clearTimeout(startCooldownTimer);
        }
        startCooldownTimer = window.setTimeout(() => {
          isStartCooldown.value = false;
          startCooldownTimer = null;
        }, 5000);
      }
    } else if (event.type === "room:chat") {
      chatMessages.value.push(event.payload as ChatPayload);
    } else if (event.type === "room:connection-status") {
      const payload = event.payload as RoomConnectionStatusPayload;
      connectionStatus.value = payload.status;
      connectionReason.value = payload.reason || "";
      reconnectAttempts.value = payload.attempts;
      startReconnectCountdown(payload.nextRetryMs);
    } else if (event.type === "room:relay:latency") {
      relayLatency.value = event.payload as RoomRelayLatencyPayload;
    } else if (event.type === "room:player:joined") {
      const payload = event.payload as PlayerInRoom;
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: "system",
        senderName: "System",
        content: t("room.playerJoined", { name: payload.name }),
        timestamp: Date.now(),
        isSystem: true,
      });
      // Update room players list
      if (room.value) {
        const exists = room.value.players.some((p) => p.id === payload.id);
        if (!exists) {
          room.value.players.push(payload);
        }
      }
    } else if (event.type === "room:player:left") {
      const payload = event.payload as { playerId: string };
      const p = room.value?.players.find((p) => p.id === payload.playerId);
      const name = p ? p.name : "Unknown";
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: "system",
        senderName: "System",
        content: t("room.playerLeft", { name: name }),
        timestamp: Date.now(),
        isSystem: true,
      });

    } else if (event.type === "room:disbanded") {
      room.value = null;
      chatMessages.value = [];
      isStartCooldown.value = false;
      relayLatency.value = null;
      resetConnectionStatus();
    } else if (event.type === "room:kicked") {
      room.value = null;
      chatMessages.value = [];
      isStartCooldown.value = false;
      relayLatency.value = null;
      resetConnectionStatus();
    } else if (event.type === "room:player:kicked") {
      const payload = event.payload as { playerId: string; name?: string };
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: "system",
        senderName: "System",
        content: t("room.playerKicked", { name: payload.name || payload.playerId }),
        timestamp: Date.now(),
        isSystem: true,
      });
    } else if (event.type === "room:game:start") {
      chatMessages.value.push({
        id: window.crypto.randomUUID(),
        senderId: "system",
        senderName: "System",
        content: t("room.gameStarted"),
        timestamp: Date.now(),
        isSystem: true,
      });
    } else if (event.type === "room:game:end") {
      // reconnectPlayerIds 由 RoomServer 通过 state sync 管理，此处无需手动重置
    }
  }

  return {
    room,
    isConnecting,
    connectionStatus,
    connectionReason,
    reconnectAttempts,
    reconnectCountdownSec,
    relayLatency,
    localPlayerId,
    isHost,
    isStartCooldown,
    isReconnectMode,
    localPlayer,
    allReady,
    chatMessages,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    startGame,
    reconnectGame,
    kickPlayer,
    handleRoomEvent,
    sendChatMessage,
    resetConnectionStatus,
  };
});
