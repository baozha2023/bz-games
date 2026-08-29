<template>
  <template v-if="isPopupWindow">
    <router-view />
  </template>
  <n-layout v-else position="absolute">
    <n-layout-header bordered style="height: 64px; padding: 16px">
      <n-space justify="space-between" align="center">
        <h2 style="margin: 0; display: flex; align-items: center">
          <button
            class="profile-entry"
            @click="router.push('/personalization')"
          >
            <AvatarWithFrame
              :src="settingsStore.settings?.avatar"
              :name="settingsStore.settings?.playerName || ''"
              :size="28"
              :frame-file-name="topBarFrameFileName"
            />
            <NicknameText
              :name="settingsStore.settings?.playerName || ''"
              :nickname-style="settingsStore.settings?.nicknameStyle"
              :effective-theme="settingsStore.effectiveTheme"
              :size="20"
              style="margin-left: 8px"
            />
            <span v-if="isOnline" class="online-badge">
              <span class="online-badge-dot" aria-hidden="true"></span>
              {{ t("settings.online") }}
            </span>
          </button>

          <div class="economy-entry-group">
            <button
              class="economy-entry coin-entry"
              type="button"
              :title="t('bzCoinGuide.title')"
              @click="showBzCoinGuide = true"
            >
              <img :src="bzCoinIcon" class="coin-entry-icon" />
              <span>{{ settingsStore.userData?.bzCoins || 0 }}</span>
            </button>
            <button
              class="economy-entry check-in-entry"
              type="button"
              :title="t('checkIn.title')"
              :aria-label="t('checkIn.title')"
              @click="showCheckIn = true"
            >
              <n-icon :component="Calendar" size="17" />
            </button>
          </div>
        </h2>
        <n-space>
          <n-button
            v-if="roomStore.room"
            secondary
            type="primary"
            @click="handleBackToRoom"
          >
            {{ t("nav.backToRoom") }}
          </n-button>
          <n-button
            :type="activeNavKey === 'market' ? 'primary' : 'default'"
            @click="router.push('/markets')"
            >{{ t("nav.market") }}</n-button
          >
          <n-button
            :type="activeNavKey === 'library' ? 'primary' : 'default'"
            @click="router.push('/library')"
            >{{ t("nav.myGames") }}</n-button
          >
          <div class="badge-wrapper">
            <span
              v-if="gameStore.newAchievements.size > 0"
              class="red-dot"
            ></span>
            <n-button
              :type="activeNavKey === 'career' ? 'primary' : 'default'"
              @click="router.push('/career')"
              >{{ t("nav.career") }}</n-button
            >
          </div>
          <n-button
            :type="activeNavKey === 'rooms' ? 'primary' : 'default'"
            @click="router.push('/rooms')"
            >{{ t("nav.rooms") }}</n-button
          >
          <n-button
            v-if="isLoggedIn"
            :type="activeNavKey === 'social' ? 'primary' : 'default'"
            @click="router.push('/social')"
            >{{ t("nav.social") }}</n-button
          >
          <n-button
            :type="activeNavKey === 'settings' ? 'primary' : 'default'"
            @click="router.push('/settings')"
            >{{ t("nav.settings") }}</n-button
          >
        </n-space>
      </n-space>
    </n-layout-header>
    <n-layout position="absolute" style="top: 64px; bottom: 0">
      <router-view />
    </n-layout>
    <CheckInModal v-model:show="showCheckIn" />
    <BzCoinGuideModal v-model:show="showBzCoinGuide" />
    <BackupManager />
    <UpdatePrompt />
  </n-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { NSpace, NIcon, NButton, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useRoomStore } from "./stores/useRoomStore";
import { useGameStore } from "./stores/useGameStore";
import { Calendar } from "@vicons/ionicons5";
import CheckInModal from "./components/CheckInModal.vue";
import BzCoinGuideModal from "./components/BzCoinGuideModal.vue";
import BackupManager from "./components/settings/BackupManager.vue";
import UpdatePrompt from "./components/settings/UpdatePrompt.vue";
import AvatarWithFrame from "./components/AvatarWithFrame.vue";
import NicknameText from "./components/NicknameText.vue";
import { AchievementNotifier } from "./utils/achievementNotifier";
import bzCoinIcon from "./assets/images/bz-coin.png";
import { type MarketTaskState } from "../../shared/types";
import { getFrameImageFileName } from "../../shared/avatar-frames";

const marketNotifiedTaskIds = new Set<string>();
const manualImportNotifiedTaskIds = new Set<string>();

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const settingsStore = useSettingsStore();
const roomStore = useRoomStore();
const gameStore = useGameStore();
const message = useMessage();
const showCheckIn = ref(false);
const showBzCoinGuide = ref(false);
const isOnline = ref(false);
const isLoggedIn = ref(false);

async function consumeForumAction(): Promise<void> {
  const action =
    typeof route.query.forumAction === "string" ? route.query.forumAction : "";
  if (action !== "check-in" && action !== "bz-coin-guide") return;
  if (action === "check-in") showCheckIn.value = true;
  else showBzCoinGuide.value = true;
  const query = { ...route.query };
  delete query.forumAction;
  await router.replace({ query });
}

watch(
  () => route.query.forumAction,
  () => void consumeForumAction(),
  { immediate: true },
);

watch(
  () => settingsStore.settings?.language,
  (language, previousLanguage) => {
    if (language && previousLanguage && language !== previousLanguage) {
      void gameStore.loadGames();
    }
  },
);

const topBarFrameFileName = computed(() => {
  const frameId = settingsStore.userData?.equippedFrame;
  if (!frameId) return undefined;
  return getFrameImageFileName(frameId);
});

const isPopupWindow = computed(() => {
  return (
    route.name === "Notification" ||
    route.name === "ChatPopout" ||
    route.name === "FloatBall"
  );
});

const activeNavKey = computed(() => {
  if (route.name === "MarketList" || route.name === "Market") return "market";
  if (route.name === "Library" || route.name === "GameDetail") return "library";
  if (route.name === "Career") return "career";
  if (route.name === "RoomDiscovery" || route.name === "Room") return "rooms";
  if (route.name === "Social" || route.name === "SocialPost") return "social";
  if (route.name === "Settings") return "settings";
  return "";
});

const handleBackToRoom = () => {
  if (roomStore.room && roomStore.room.gameId) {
    router.push({
      name: "Room",
      params: { id: roomStore.room.gameId },
      query:
        route.query.steamGameId === roomStore.room.gameId
          ? { fromSteam: "1" }
          : undefined,
    });
  }
};

let cleanup: (() => void) | undefined;
let cleanupAchievements: (() => void) | undefined;
let cleanupGameImportEvent: (() => void) | undefined;
let cleanupMarketEvent: (() => void) | undefined;
let cleanupPresence: (() => void) | undefined;
let cleanupAccountAuth: (() => void) | undefined;
const achievementNotifier = new AchievementNotifier({
  delayMs: 5200,
  onProcess: async () => {
    await gameStore.loadGames();
  },
});

const MARKET_ERROR_KEYS: Record<string, string> = {
  network: "market.networkError",
  download: "market.downloadError",
  verify: "market.verifyError",
  extract: "market.extractError",
  install: "market.installError",
  manifest: "market.manifestMissing",
};

function marketErrorMessage(task: MarketTaskState): string {
  if (task.errorCode && MARKET_ERROR_KEYS[task.errorCode]) {
    return t(MARKET_ERROR_KEYS[task.errorCode]);
  }
  return task.message || "";
}

const refreshPresenceStatus = async () => {
  try {
    const status = await window.electronAPI.settings.getPresenceStatus();
    isOnline.value = status.enabled;
  } catch {
    isOnline.value = false;
  }
};

const refreshAccountStatus = async () => {
  try {
    const status = await window.electronAPI.settings.getLocalAccountStatus();
    isLoggedIn.value = status.authenticated;
  } catch {
    isLoggedIn.value = false;
  }
};

onMounted(() => {
  if (isPopupWindow.value) return;

  cleanupPresence = window.electronAPI.settings.onPresenceChanged((payload) => {
    isOnline.value = payload.enabled;
  });
  cleanupAccountAuth = window.electronAPI.settings.onAccountAuthChanged(
    (payload) => {
      isLoggedIn.value = payload.status.authenticated;
    },
  );
  void refreshPresenceStatus();
  void refreshAccountStatus();

  if (window.electronAPI?.room?.onEvent) {
    cleanup = window.electronAPI.room.onEvent((event) => {
      roomStore.handleRoomEvent(event);
    });
  }

  if (window.electronAPI?.game?.onAchievementUnlocked) {
    cleanupAchievements = window.electronAPI.game.onAchievementUnlocked(
      (gameId, version, achievementId) => {
        achievementNotifier.enqueue({ gameId, version, achievementId });
      },
    );
  }

  if (window.electronAPI?.game?.onImportEvent) {
    cleanupGameImportEvent = window.electronAPI.game.onImportEvent(
      ({ task }) => {
        if (
          task.status !== "completed" ||
          manualImportNotifiedTaskIds.has(task.taskId)
        ) {
          return;
        }
        manualImportNotifiedTaskIds.add(task.taskId);
        message.success(
          t("library.addSuccessWithVersion", {
            name: task.gameName || task.gameId,
            version: task.version,
          }),
        );
      },
    );
  }

  if (window.electronAPI?.market?.onEvent) {
    cleanupMarketEvent = window.electronAPI.market.onEvent(({ task }) => {
      if (task.status === "idle") {
        marketNotifiedTaskIds.delete(task.taskId);
        return;
      }

      if (!marketNotifiedTaskIds.has(task.taskId)) {
        if (task.status === "completed") {
          marketNotifiedTaskIds.add(task.taskId);
          const game = gameStore.games.find((g) => g.id === task.gameId);
          const gameName = task.gameName || game?.name || task.gameId;
          message.success(
            t("market.installSuccess", {
              name: gameName,
              version: task.version,
            }),
          );
        } else if (task.status === "error") {
          marketNotifiedTaskIds.add(task.taskId);
          const errMsg = marketErrorMessage(task);
          message.error(errMsg || t("market.downloadFailed"));
        } else if (task.status === "canceled") {
          marketNotifiedTaskIds.add(task.taskId);
          message.info(t("market.canceled"));
        }
      }
    });
  }

  void settingsStore.loadSettings().then(async () => {
    await gameStore.loadGames();
    await window.electronAPI.update.rendererHealthy();
  });
});

onUnmounted(() => {
  if (cleanup) cleanup();
  if (cleanupAchievements) cleanupAchievements();
  if (cleanupGameImportEvent) cleanupGameImportEvent();
  if (cleanupMarketEvent) cleanupMarketEvent();
  if (cleanupPresence) cleanupPresence();
  if (cleanupAccountAuth) cleanupAccountAuth();
  achievementNotifier.dispose();
});
</script>

<style scoped>
.badge-wrapper {
  position: relative;
  display: inline-block;
}

.profile-entry {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.profile-entry:hover {
  opacity: 0.86;
}

.online-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 7px;
  border-radius: 10px;
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}

.online-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.14);
}

.economy-entry-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 16px;
}

.economy-entry {
  height: 32px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: transparent;
  box-shadow: none;
  color: var(--bz-text-title);
  font: inherit;
  cursor: pointer;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.economy-entry:hover {
  background: transparent;
  box-shadow: none;
  opacity: 0.82;
  transform: translateY(-1px);
}

.economy-entry:active {
  box-shadow: none;
}

.economy-entry:focus-visible {
  outline: 2px solid var(--bz-info-blue);
  outline-offset: 2px;
}

.coin-entry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 11px 0 9px;
  color: var(--bz-gold);
  font-size: 14px;
  font-weight: 700;
}

.coin-entry-icon {
  width: 18px;
  height: 18px;
}

.check-in-entry {
  display: inline-flex;
  width: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.red-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  background-color: var(--bz-red);
  border-radius: 50%;
  z-index: 1;
}
</style>
