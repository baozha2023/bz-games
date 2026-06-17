<template>
  <div ref="containerRef" class="calendar-heatmap">
    <div class="heatmap-header" :style="{ marginBottom: `${gap}px` }">
      <n-text depth="2" :style="{ fontSize: `${clampFont(cellSize * 0.9, 11, 15)}px` }">
        {{ t('statistics.playCalendar') }}
      </n-text>
      <div class="heatmap-legend" :style="{ gap: `${Math.max(2, gap * 0.6)}px` }">
        <span class="legend-label" :style="{ fontSize: `${clampFont(cellSize * 0.75, 9, 12)}px`, margin: `0 ${Math.max(2, gap * 0.6)}px` }">
          {{ t('statistics.less') }}
        </span>
        <div
          v-for="level in 5"
          :key="level"
          class="legend-cell"
          :style="{
            backgroundColor: COLORS[level - 1],
            width: `${Math.round(cellSize * 0.85)}px`,
            height: `${Math.round(cellSize * 0.85)}px`,
            borderRadius: `${Math.max(1, Math.round(cellSize * 0.15))}px`,
          }"
        />
        <span class="legend-label" :style="{ fontSize: `${clampFont(cellSize * 0.75, 9, 12)}px`, margin: `0 ${Math.max(2, gap * 0.6)}px` }">
          {{ t('statistics.more') }}
        </span>
      </div>
    </div>
    <div class="heatmap-body" :style="{ overflowX: needsScrollbar ? 'auto' : 'hidden' }">
      <div class="heatmap-body-inner">
      <div
        class="month-labels"
        :style="{
          gridTemplateColumns: `repeat(54, ${cellSize}px)`,
          gap: `${gap}px`,
          marginBottom: `${gap}px`,
          marginLeft: `${dayLabelWidth + gap}px`,
        }"
      >
        <span
          v-for="(label, idx) in monthLabels"
          :key="idx"
          class="month-label"
          :style="{
            gridColumn: label.col + ' / span ' + label.span,
            fontSize: `${clampFont(cellSize * 0.7, 8, 11)}px`,
          }"
        >{{ label.text }}</span>
      </div>
      <div class="heatmap-grid">
        <div
          class="day-labels"
          :style="{
            gap: `${gap}px`,
            marginRight: `${gap * 2}px`,
            width: `${dayLabelWidth}px`,
          }"
        >
          <span
            v-for="day in dayLabels"
            :key="day"
            class="day-label"
            :style="{
              fontSize: `${clampFont(cellSize * 0.7, 8, 11)}px`,
              height: `${cellSize}px`,
              lineHeight: `${cellSize}px`,
            }"
          >{{ day }}</span>
        </div>
        <div
          class="cells-grid"
          :style="{
            gridTemplateRows: `repeat(7, ${cellSize}px)`,
            gridAutoColumns: `${cellSize}px`,
            gap: `${gap}px`,
          }"
        >
          <div
            v-for="cell in cells"
            :key="cell.date"
            class="heatmap-cell"
            :class="{ 'heatmap-cell-active': selectedDate === cell.date }"
            :style="{
              backgroundColor: cell.color,
              width: `${cellSize}px`,
              height: `${cellSize}px`,
              borderRadius: `${Math.max(1, Math.round(cellSize * 0.15))}px`,
            }"
            @click="handleCellClick(cell.date)"
          >
            <n-tooltip trigger="hover">
              <template #trigger>
                <div class="cell-inner" />
              </template>
              {{ cell.tooltip }}
            </n-tooltip>
          </div>
        </div>
      </div>
      </div>
    </div>
    <div class="heatmap-total" :style="{ marginTop: `${gap * 2}px` }">
      <n-text depth="3" :style="{ fontSize: `${clampFont(cellSize * 0.8, 10, 14)}px` }">
        {{ t('statistics.totalPlaytime') }}: {{ formatTotalDuration(totalDurationMs) }}
      </n-text>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTooltip, NText } from 'naive-ui'

const { t } = useI18n()

interface CellData {
  date: string
  durationMs: number
  color: string
  tooltip: string
}

interface MonthLabel {
  text: string
  col: number
  span: number
}

const props = defineProps<{
  dailyDurations: { date: string; total_duration_ms: number }[]
  selectedDate?: string
}>()

const emit = defineEmits<{
  (e: 'select-date', date: string): void
}>()

const CONTAINER_PADDING = 32
const DAY_LABEL_RATIO = 1.8
const GAP_RATIO = 0.18
const MAX_WEEKS = 54
const MIN_CELL = 8
const MAX_CELL = 24

const containerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(640)

let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0

const cellSize = computed(() => {
  const w = containerWidth.value - CONTAINER_PADDING
  const dayLabelAndMargin = DAY_LABEL_RATIO + GAP_RATIO * 2
  const gridTotal = MAX_WEEKS + (MAX_WEEKS - 1) * GAP_RATIO
  const divisor = dayLabelAndMargin + gridTotal
  const raw = Math.floor(w / divisor)
  return Math.max(MIN_CELL, Math.min(MAX_CELL, raw))
})

const gap = computed(() => Math.max(1, Math.round(cellSize.value * GAP_RATIO)))

const dayLabelWidth = computed(() => Math.round(cellSize.value * DAY_LABEL_RATIO))

const needsScrollbar = computed(() => {
  const totalCellWidth = MAX_WEEKS * cellSize.value + (MAX_WEEKS - 1) * gap.value
  const total = dayLabelWidth.value + gap.value * 2 + totalCellWidth + CONTAINER_PADDING
  return total > containerWidth.value
})

function clampFont(raw: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, raw)))
}

function setContainerWidth(width: number): void {
  const nextWidth = Math.round(width)
  if (nextWidth <= 0 || nextWidth === containerWidth.value) return
  containerWidth.value = nextWidth
}

onMounted(() => {
  if (!containerRef.value) return
  setContainerWidth(containerRef.value.getBoundingClientRect().width)
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    const nextWidth = Math.round(entry.contentRect.width)
    if (nextWidth === containerWidth.value) return
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      setContainerWidth(nextWidth)
    })
  })
  resizeObserver.observe(containerRef.value)
})

onUnmounted(() => {
  if (resizeFrame) {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = 0
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})

const dayLabels = computed(() => {
  const labels = t('statistics.weekDays', { returnEmptyString: true } as any)
  if (typeof labels === 'string' && labels.length > 0) return labels.split(',')
  return ['', '一', '', '三', '', '五', '']
})

function getMonthNames(): string[] {
  const names = t('statistics.monthNames', { returnEmptyString: true } as any) as unknown as string
  if (typeof names === 'string' && names.length > 0) return names.split(',')
  return ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
}

const COLORS = [
  'var(--bz-bg-panel)',
  '#39d353',
  '#26a641',
  '#006d32',
  '#0e4429',
]

function getLevel(durationMs: number): number {
  if (durationMs <= 0) return 0
  const minutes = durationMs / 60000
  if (minutes < 15) return 1
  if (minutes < 60) return 2
  if (minutes < 180) return 3
  return 4
}

function formatDurationMs(ms: number): string {
  if (ms <= 0) return t('statistics.noPlay')
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}${t('statistics.minute')}`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (rem === 0) return `${hours}${t('statistics.hour')}`
  return `${hours}${t('statistics.hour')}${rem}${t('statistics.minute')}`
}

function formatTotalDuration(ms: number): string {
  if (ms <= 0) return '0h'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

const totalDurationMs = computed(() => {
  return props.dailyDurations.reduce((sum, d) => sum + d.total_duration_ms, 0)
})

const selectedDate = computed(() => props.selectedDate || '')

const cells = computed<CellData[]>(() => {
  const now = new Date()
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 364)

  const dayOfWeek = startDate.getDay()
  if (dayOfWeek > 0) {
    startDate.setDate(startDate.getDate() - dayOfWeek)
  }

  const durationMap = new Map<string, number>()
  for (const entry of props.dailyDurations) {
    durationMap.set(entry.date, entry.total_duration_ms)
  }

  const result: CellData[] = []
  const current = new Date(startDate)
  while (current <= endDate) {
    const dateStr = formatDateStr(current)
    const durationMs = durationMap.get(dateStr) || 0
    const level = getLevel(durationMs)
    const color = COLORS[level]
    const tooltip = `${dateStr}: ${formatDurationMs(durationMs)}`
    result.push({ date: dateStr, durationMs, color, tooltip })
    current.setDate(current.getDate() + 1)
  }
  return result
})

const monthLabels = computed<MonthLabel[]>(() => {
  const now = new Date()
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 364)

  const dayOfWeek = startDate.getDay()
  if (dayOfWeek > 0) {
    startDate.setDate(startDate.getDate() - dayOfWeek)
  }

  const monthNames = getMonthNames()

  const labels: { month: number; col: number }[] = []
  const current = new Date(startDate)
  let colIndex = 1
  let prevMonth = -1

  while (current <= endDate) {
    const weekIndex = Math.floor(colIndex / 7) + 1
    const month = current.getMonth()
    if (month !== prevMonth) {
      labels.push({ month, col: weekIndex })
      prevMonth = month
    }
    colIndex++
    current.setDate(current.getDate() + 1)
  }

  const totalWeeks = Math.ceil(colIndex / 7)
  return labels.map((item, idx) => {
    const nextCol = idx < labels.length - 1 ? labels[idx + 1].col : totalWeeks + 1
    const span = nextCol - item.col
    return {
      text: monthNames[item.month],
      col: item.col,
      span: Math.max(1, span),
    }
  })
})

function formatDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function handleCellClick(date: string) {
  emit('select-date', date)
}
</script>

<style scoped>
.calendar-heatmap {
  width: 100%;
  min-width: 0;
  padding: 16px 0;
  user-select: none;
}

.heatmap-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.heatmap-legend {
  display: flex;
  align-items: center;
}

.legend-label {
  color: var(--bz-text-hint);
  white-space: nowrap;
}

.legend-cell {
  flex-shrink: 0;
}

.heatmap-body {
  min-width: 0;
  overflow-x: auto;
}

.heatmap-body-inner {
  display: table;
  margin: 0 auto;
}

.month-labels {
  display: grid;
}

.month-label {
  color: var(--bz-text-hint);
  text-align: left;
}

.heatmap-grid {
  display: flex;
}

.day-labels {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.day-label {
  color: var(--bz-text-hint);
  text-align: right;
}

.cells-grid {
  display: grid;
  grid-auto-flow: column;
}

.heatmap-cell {
  cursor: pointer;
  transition: outline 0.1s;
}

.heatmap-cell:hover {
  outline: 2px solid var(--bz-text-title);
  outline-offset: -1px;
}

.heatmap-cell-active {
  outline: 2px solid var(--bz-green);
  outline-offset: -1px;
}

.cell-inner {
  width: 100%;
  height: 100%;
}

.heatmap-total {
  text-align: right;
}
</style>
