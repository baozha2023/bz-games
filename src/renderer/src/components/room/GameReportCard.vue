<template>
  <div v-if="report" class="game-report-card" :style="cardStyle">
    <!-- ── 纯文本模式 ── -->
    <div v-if="isTextMode" class="report-text">{{ reportText }}</div>

    <!-- ── 自定义 HTML 模式 (sandbox iframe) ── -->
    <iframe
      v-else-if="isCustomMode"
      :srcdoc="customSrcdoc"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      class="report-custom-iframe"
      :style="{ minHeight: '120px' }"
    />

    <!-- ── 计分板布局 ── -->
    <template v-else-if="isScoreboard && scoreboardData">
      <div class="report-scoreboard" :class="{ compact: scoreboardConfig.compact }">
        <div v-if="scoreboardData.title" class="scoreboard-title">{{ scoreboardData.title }}</div>

        <!-- 表头 -->
        <div class="scoreboard-header" :style="headerGridStyle">
          <div v-if="scoreboardConfig.showRank !== false" class="col col-rank">#</div>
          <div
            v-for="col in scoreboardConfig.columns"
            :key="col.key"
            class="col"
            :style="colStyle(col)"
          >
            {{ col.label || col.key }}
          </div>
        </div>

        <!-- 数据行 -->
        <div
          v-for="(row, rowIdx) in scoreboardData.rows"
          :key="rowIdx"
          class="scoreboard-row"
          :class="rowClass(rowIdx)"
          :style="rowStyle(rowIdx)"
        >
          <div v-if="scoreboardConfig.showRank !== false" class="col col-rank">
            <span class="rank-badge" :class="'rank-' + (rowIdx + 1)">{{ rankLabel(rowIdx) }}</span>
          </div>
          <div
            v-for="col in scoreboardConfig.columns"
            :key="col.key"
            class="col"
            :style="colStyle(col)"
          >
            <!-- 头像渲染 -->
            <AvatarWithFrame
              v-if="col.render === 'avatar'"
              :src="playerInfo(row, col.key)?.avatar"
              :name="playerInfo(row, col.key)?.name || String(row[col.key] ?? '')"
              :size="scoreboardConfig.compact ? 28 : 36"
              :frame-file-name="playerInfo(row, col.key)?.avatarFrameFile"
            />
            <!-- 玩家名渲染（含昵称样式） -->
            <NicknameText
              v-else-if="col.render === 'playerName'"
              :name="playerInfo(row, col.key)?.name || String(row[col.key] ?? '')"
              :nickname-style="playerInfo(row, col.key)?.nicknameStyle"
              :effective-theme="settingsStore.effectiveTheme"
              :size="scoreboardConfig.compact ? 13 : 14"
            />
            <!-- 徽章渲染 -->
            <span
              v-else-if="col.render === 'badge'"
              class="col-badge"
              :style="{ backgroundColor: badgeColor(col, row[col.key]), color: badgeTextColor(col, row[col.key]) }"
            >
              {{ row[col.key] }}
            </span>
            <!-- 分数渲染 -->
            <span v-else-if="col.render === 'score'" class="col-score">{{ row[col.key] }}</span>
            <!-- 默认文本渲染 -->
            <span v-else>{{ row[col.key] }}</span>
          </div>
        </div>

        <!-- 统计 -->
        <div v-if="scoreboardData.stats && scoreboardData.stats.length" class="scoreboard-stats">
          <div v-for="stat in scoreboardData.stats" :key="stat.label" class="stat-row">
            <span class="stat-label">{{ stat.label }}</span>
            <span class="stat-values">
              <template v-for="col in scoreboardConfig.columns" :key="col.key">
                <span v-if="stat.values[String(col.key)] !== undefined" class="stat-value" :style="colStyle(col)">
                  {{ stat.values[String(col.key)] }}
                </span>
              </template>
            </span>
          </div>
        </div>

        <!-- 时长 -->
        <div v-if="scoreboardData.duration != null" class="scoreboard-duration">
          {{ formatDuration(scoreboardData.duration) }}
        </div>
      </div>
    </template>

    <!-- ── 对决布局 ── -->
    <template v-else-if="isVersus && versusData">
      <div class="report-versus">
        <div v-if="versusData.title" class="versus-title">{{ versusData.title }}</div>
        <div class="versus-body">
          <div class="versus-side" :class="{ winner: versusData.left.won }" :style="leftSideStyle || undefined">
            <img v-if="versusData.left.avatar" :src="versusData.left.avatar" class="versus-avatar" />
            <span class="versus-label">{{ versusData.left.label }}</span>
          </div>
          <div class="versus-score" :style="{ fontSize: (versusConfig.scoreFontSize || 32) + 'px' }">
            {{ versusData.left.score }}
            <span class="versus-sep">{{ versusConfig.separator || ' : ' }}</span>
            {{ versusData.right.score }}
          </div>
          <div class="versus-side" :class="{ winner: versusData.right.won }" :style="rightSideStyle || undefined">
            <img v-if="versusData.right.avatar" :src="versusData.right.avatar" class="versus-avatar" />
            <span class="versus-label">{{ versusData.right.label }}</span>
          </div>
        </div>
        <div v-if="versusData.duration != null" class="versus-duration">
          {{ formatDuration(versusData.duration) }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatPayload } from '../../../../shared/types'
import type {
  GameReportPayload,
  GameReportStructuredPayload,
  GameReportCustomPayload,
  GameReportScoreboardData,
  GameReportScoreboardConfig,
  GameReportVersusData,
  GameReportVersusConfig,
  GameReportColumnDef,
} from '../../../../shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useRoomStore } from '../../stores/useRoomStore'
import NicknameText from '../NicknameText.vue'
import AvatarWithFrame from '../AvatarWithFrame.vue'
import { getFrameImageFileName } from '../../../../shared/avatar-frames'

const props = defineProps<{ msg: ChatPayload }>()

const settingsStore = useSettingsStore()
const roomStore = useRoomStore()

// ── 解析 ──
const report = computed<GameReportPayload | null>(() => {
  try {
    if (props.msg.contentType !== 'game_report') return null
    return JSON.parse(props.msg.content) as GameReportPayload
  } catch {
    return null
  }
})

const reportText = computed(() => (report.value as { text?: string } | null)?.text || '')

const isTextMode = computed(() => !report.value?.mode)
const isCustomMode = computed(() => report.value?.mode === 'custom')

// ── 计分板 ──
const isScoreboard = computed(() =>
  report.value?.mode === 'structured' && (report.value as GameReportStructuredPayload).data.layout === 'scoreboard'
)

const scoreboardData = computed(() => {
  if (!isScoreboard.value) return null
  const p = report.value as GameReportStructuredPayload
  const d = p.data as GameReportScoreboardData
  return { title: p.title, rows: d.rows, stats: d.stats, duration: d.duration }
})

const scoreboardConfig = computed<GameReportScoreboardConfig>(() => {
  const defaults: GameReportScoreboardConfig = { columns: [], highlightTop: 3, compact: false, showRank: true }
  const cfg = (report.value as GameReportStructuredPayload | null)?.config as GameReportScoreboardConfig | undefined
  return { ...defaults, ...cfg }
})

const headerGridStyle = computed(() => {
  const cols = scoreboardConfig.value.columns
  const showRank = scoreboardConfig.value.showRank !== false
  const template = showRank ? `50px ` : ''
  return { gridTemplateColumns: template + cols.map(c => c.width || '1fr').join(' ') }
})

// ── 对决 ──
const isVersus = computed(() =>
  report.value?.mode === 'structured' && (report.value as GameReportStructuredPayload).data.layout === 'versus'
)

const versusData = computed(() => {
  if (!isVersus.value) return null
  const p = report.value as GameReportStructuredPayload
  const d = p.data as GameReportVersusData
  return { title: p.title, left: d.left, right: d.right, duration: d.duration }
})

const versusConfig = computed<GameReportVersusConfig>(() =>
  ((report.value as GameReportStructuredPayload | null)?.config as GameReportVersusConfig | undefined) || {}
)

// ── 自定义 HTML ──
const customSrcdoc = computed(() => {
  const p = report.value as GameReportCustomPayload | null
  if (!p) return ''
  const theme = p.theme || 'auto'
  let themeVars = ''
  if (theme === 'dark') {
    themeVars = 'color-scheme: dark; background: #1a1a2e; color: #e0e0e0;'
  } else if (theme === 'light') {
    themeVars = 'color-scheme: light; background: #ffffff; color: #333;'
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>:root { ${themeVars} font-family: system-ui, -apple-system, sans-serif; } body { margin: 0; padding: 12px; } ${p.css || ''}</style></head><body>${p.html}</body></html>`
})

// ── 整体卡片样式 ──
const cardStyle = computed(() => {
  if (isTextMode.value) return ''
  return (report.value as GameReportStructuredPayload | null)?.style || ''
})

// ── 对决侧样式 ──
const leftSideStyle = computed(() => versusConfig.value.leftStyle || '')
const rightSideStyle = computed(() => versusConfig.value.rightStyle || '')

function colStyle(col: GameReportColumnDef) {
  const s: Record<string, string> = {}
  if (col.align) s.textAlign = col.align
  if (col.width) s.width = col.width
  return s
}

function rowClass(rowIdx: number) {
  const top = scoreboardConfig.value.highlightTop ?? 3
  if (rowIdx === 0 && top >= 1) return 'highlight-gold'
  if (rowIdx === 1 && top >= 2) return 'highlight-silver'
  if (rowIdx === 2 && top >= 3) return 'highlight-bronze'
  return ''
}

function rowStyle(rowIdx: number) {
  const tpl = scoreboardConfig.value.rowStyle
  if (!tpl) return ''
  return tpl.replace(/\{rowIndex\}/g, String(rowIdx))
}

function rankLabel(rowIdx: number) {
  const fmt = scoreboardConfig.value.rankLabel
  if (!fmt) return String(rowIdx + 1)
  return fmt.replace(/\{n\}/g, String(rowIdx + 1))
}

const RANK_COLORS: Record<number, string> = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' }
const RANK_TEXT_COLORS: Record<number, string> = { 1: '#5c3d00', 2: '#333', 3: '#3d1f00' }

function badgeColor(col: GameReportColumnDef, value: unknown) {
  if (col.badgeColors && typeof value === 'number') return col.badgeColors[value] || ''
  if (col.badgeColors && typeof value === 'string') return col.badgeColors[value] || ''
  if (typeof value === 'number' && value <= 3) return RANK_COLORS[value] || ''
  return 'var(--bz-primary)'
}

function badgeTextColor(col: GameReportColumnDef, value: unknown) {
  if (col.badgeColors) return '#fff'
  if (typeof value === 'number' && value <= 3) return RANK_TEXT_COLORS[value] || '#fff'
  return '#fff'
}

/** 从房间玩家列表反查玩家信息 */
function playerInfo(row: Record<string, unknown>, key: string) {
  const id = String(row[key] ?? '')
  const player = roomStore.room?.players.find(p => p.id === id)
  if (!player) return null
  return {
    name: player.name,
    avatar: player.avatar,
    nicknameStyle: player.nicknameStyle,
    avatarFrameFile: player.avatarFrame ? getFrameImageFileName(player.avatarFrame) : undefined,
  }
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.game-report-card {
  max-width: 560px;
  width: 100%;
  margin: 4px 0;
  overflow: hidden;
}

.report-text {
  font-size: 12px;
  color: var(--bz-chat-text-system);
  text-align: center;
}

/* ── custom iframe ── */
.report-custom-iframe {
  width: 100%;
  min-height: 120px;
  max-width: 560px;
  border: none;
  border-radius: 8px;
  overflow: hidden;
}

/* ── scoreboard ── */
.report-scoreboard {
  background: var(--bz-bg-chat-bubble);
  border-radius: 10px;
  padding: 14px;
  font-size: 13px;
  border: 1px solid var(--bz-border-subtle);
}

.report-scoreboard.compact {
  padding: 8px;
  font-size: 12px;
}

.scoreboard-title {
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 10px;
  text-align: center;
  color: var(--bz-text-primary);
}

.scoreboard-header {
  display: grid;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--bz-chat-text-system);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-bottom: 1px solid var(--bz-border-subtle);
  padding-bottom: 6px;
  margin-bottom: 6px;
}

.scoreboard-row {
  display: grid;
  gap: 4px;
  align-items: center;
  padding: 5px 0;
  border-radius: 6px;
  transition: background 0.15s;
}

.scoreboard-row:hover {
  background: var(--bz-bg-hover);
}

.scoreboard-row.highlight-gold {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.14), rgba(255, 180, 0, 0.06));
}

.scoreboard-row.highlight-silver {
  background: linear-gradient(135deg, rgba(192, 192, 192, 0.14), rgba(160, 160, 160, 0.06));
}

.scoreboard-row.highlight-bronze {
  background: linear-gradient(135deg, rgba(205, 127, 50, 0.12), rgba(180, 100, 30, 0.05));
}

.col {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.col-rank {
  justify-content: center;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: #666;
  background: var(--bz-bg-subtle);
}

.rank-badge.rank-1 { background: #FFD700; color: #5c3d00; }
.rank-badge.rank-2 { background: #C0C0C0; color: #333; }
.rank-badge.rank-3 { background: #CD7F32; color: #3d1f00; }

.col-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
}

.col-score {
  font-weight: 700;
  font-size: 14px;
}

/* ── stats ── */
.scoreboard-stats {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--bz-border-subtle);
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
}

.stat-label {
  min-width: 60px;
  flex-shrink: 0;
  color: var(--bz-chat-text-system);
  font-weight: 500;
}

.stat-values {
  display: flex;
  gap: 4px;
  flex: 1;
}

.stat-value {
  flex: 1;
}

.scoreboard-duration {
  text-align: center;
  margin-top: 8px;
  font-size: 11px;
  color: var(--bz-chat-text-system);
  font-variant-numeric: tabular-nums;
}

/* ── versus ── */
.report-versus {
  background: var(--bz-bg-chat-bubble);
  border-radius: 10px;
  padding: 16px;
  text-align: center;
  border: 1px solid var(--bz-border-subtle);
}

.versus-title {
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 10px;
}

.versus-body {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.versus-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 80px;
}

.versus-side.winner {
  font-weight: 700;
}

.versus-side.winner .versus-label {
  color: #4caf50;
}

.versus-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--bz-border);
}

.versus-label {
  font-size: 13px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.versus-score {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--bz-text-primary);
}

.versus-sep {
  font-weight: 400;
  opacity: 0.5;
}

.versus-duration {
  margin-top: 8px;
  font-size: 11px;
  color: var(--bz-chat-text-system);
  font-variant-numeric: tabular-nums;
}
</style>
