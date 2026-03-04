<template>
  <transition name="notification" appear>
    <div v-if="visible" class="notification-container" :class="theme" @click="close">
      <div class="icon-area">
        <img v-if="iconUrl" :src="iconUrl" class="game-icon" />
        <div v-else class="game-icon-placeholder">{{ gameName?.charAt(0) || '?' }}</div>
      </div>
      <div class="content-area">
        <div class="title">{{ title }}</div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const title = ref('');
const gameName = ref('');
const iconUrl = ref('');
const theme = ref('dark');
const visible = ref(false);

onMounted(() => {
  title.value = (route.query.title as string) || 'Achievement Unlocked';
  gameName.value = (route.query.gameName as string) || '';
  iconUrl.value = (route.query.icon as string) || '';
  theme.value = (route.query.theme as string) || 'dark';

  visible.value = true;

  setTimeout(() => {
    visible.value = false;
  }, 4500);
});

const close = () => {
  visible.value = false;
  setTimeout(() => {
      window.close();
  }, 300);
};
</script>

<style scoped>
.notification-container {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100vh;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  padding: 8px 12px;
  box-sizing: border-box;
  cursor: pointer;
  overflow: hidden;
  user-select: none;
  border: 1px solid transparent;
  transform-origin: bottom;
}

.notification-enter-active {
  animation: grow-in 0.3s ease-in-out;
}

.notification-leave-active {
  animation: shrink-out 0.3s ease-in-out;
}

@keyframes grow-in {
  0% { transform: translateY(100%); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

@keyframes shrink-out {
  0% { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(100%); opacity: 0; }
}

.notification-container.dark {
  background: rgba(28, 28, 30, 0.95);
  color: white;
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.notification-container.light {
  background: rgba(255, 255, 255, 0.95);
  color: #333;
  border-color: rgba(0, 0, 0, 0.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.icon-area {
  width: 40px;
  height: 40px;
  margin-right: 12px;
  flex-shrink: 0;
}

.game-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
}

.game-icon-placeholder {
  width: 100%;
  height: 100%;
  background: #444;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 18px;
  color: #fff;
}
.light .game-icon-placeholder {
  background: #eee;
  color: #666;
}

.content-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.title {
  font-weight: bold;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dark .title {
  color: #fbbf24; 
}
.light .title {
  color: #d97706; 
}

</style>
