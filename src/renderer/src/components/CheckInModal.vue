<template>
  <n-modal v-model:show="show" preset="card" :title="t('checkIn.title')" style="width: 700px">
    <div class="check-in-container">
      <div class="header">
        <div class="streak-info">
          {{ t('checkIn.streak', { days: userData?.checkIn?.consecutiveDays || 0 }) }}
        </div>
        <div class="coins-info">
          <img :src="bzCoinIcon" style="width: 24px; height: 24px;" />
          <span>{{ userData?.bzCoins || 0 }}</span>
        </div>
      </div>

      <div class="days-grid">
        <div 
          v-for="day in 7" 
          :key="day" 
          class="day-card"
          :class="{ 
            'active': isDayActive(day),
            'completed': isDayCompleted(day),
            'today': isToday(day)
          }"
        >
          <div class="day-label">{{ t('checkIn.day', { day }) }}</div>
          <div class="reward-icon">
            <img :src="bzCoinIcon" :style="{ width: day === 7 ? '40px' : '24px', height: day === 7 ? '40px' : '24px' }" />
            <span class="amount">+{{ getReward(day) }}</span>
          </div>
          <div v-if="isDayCompleted(day)" class="status-icon">
            <n-icon :component="CheckmarkCircle" color="#4CAF50" size="20" />
          </div>
        </div>
      </div>
      
      <div class="actions">
        <n-button 
          type="primary" 
          size="large" 
          @click="handleCheckIn" 
          :disabled="checkedToday"
          :loading="loading"
          block
          style="margin-top: 20px; height: 50px; font-size: 18px;"
        >
          {{ checkedToday ? t('checkIn.checked') : t('checkIn.action') }}
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/useSettingsStore';
import { CheckmarkCircle } from '@vicons/ionicons5';
import { storeToRefs } from 'pinia';
import { useMessage } from 'naive-ui';
import { NModal, NButton, NIcon } from 'naive-ui';
import bzCoinIcon from '../assets/images/bz-coin.png'

const props = defineProps<{
  show: boolean
}>();

const emit = defineEmits(['update:show']);

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { userData } = storeToRefs(settingsStore);
const message = useMessage();
const loading = ref(false);

const show = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
});

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

const getTodayStr = () => {
  return formatDate(new Date());
};

const getYesterdayStr = (base: string) => {
  const baseDate = new Date(`${base}T00:00:00+08:00`);
  const yesterday = new Date(baseDate.getTime() - 86400000);
  return formatDate(yesterday);
};

const checkedToday = computed(() => {
  if (!userData.value?.checkIn?.lastCheckInDate) return false;
  const today = getTodayStr();
  return userData.value.checkIn.lastCheckInDate === today;
});

const currentStreak = computed(() => userData.value?.checkIn?.consecutiveDays || 0);
const getCycleDay = (streak: number) => {
  if (streak <= 0) return 0;
  return ((streak - 1) % 7) + 1;
};
const currentCycleDay = computed(() => getCycleDay(currentStreak.value));

const isDayCompleted = (day: number) => {
    if (checkedToday.value) {
        return day <= currentCycleDay.value;
    } else {
        const lastDate = userData.value?.checkIn?.lastCheckInDate;
        if (!lastDate) return false;
        
        const today = getTodayStr();
        const yesterdayStr = getYesterdayStr(today);
        
        if (lastDate === yesterdayStr || lastDate === today) {
             return day <= currentCycleDay.value;
        } else {
             return false;
        }
    }
};

const isToday = (day: number) => {
    if (checkedToday.value) return false;
    
    const lastDate = userData.value?.checkIn?.lastCheckInDate;
    if (!lastDate) return day === 1;
    
    const today = getTodayStr();
    const yesterdayStr = getYesterdayStr(today);
    
    let predictedStreak = currentStreak.value;
    if (lastDate === yesterdayStr) {
        predictedStreak += 1;
    } else {
        predictedStreak = 1;
    }
    const predictedCycleDay = getCycleDay(predictedStreak);
    return day === predictedCycleDay;
};

const isDayActive = (day: number) => {
    return isDayCompleted(day) || isToday(day);
};

const getReward = (day: number) => {
    return day === 7 ? 100 : day * 10;
};

const handleCheckIn = async () => {
    loading.value = true;
    try {
        const result = await settingsStore.checkIn();
        if (result.success) {
            message.success(t('checkIn.success', { coins: result.coins }));
        } else {
            message.warning(result.message || t('checkIn.failed'));
        }
    } catch (e) {
        message.error(t('checkIn.error'));
    } finally {
        loading.value = false;
    }
};
</script>

<style scoped>
.check-in-container {
    padding: 20px;
}
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
    font-size: 1.2rem;
    font-weight: bold;
}
.coins-info {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #FFD700;
}
.days-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 10px;
}
.day-card {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    position: relative;
    border: 2px solid transparent;
    transition: all 0.3s;
}
.day-card.today {
    border-color: #FFD700;
    background: rgba(255, 215, 0, 0.1);
    transform: scale(1.05);
}
.day-card.completed {
    background: rgba(76, 175, 80, 0.1);
    border-color: #4CAF50;
}
.day-label {
    font-size: 0.9rem;
    opacity: 0.8;
}
.reward-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.amount {
    font-weight: bold;
    color: #FFD700;
}
.status-icon {
    position: absolute;
    top: 5px;
    right: 5px;
}
</style>
