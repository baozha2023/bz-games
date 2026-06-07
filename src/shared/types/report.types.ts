// ─── game.report 战绩报告类型 ────────────────────────────────────────────
// 消费端：GameReportCard.vue / RoomChat.vue / GameApiServer.ts

/** 战绩报告 Payload（联合类型：纯文本 / 结构化 / 自定义 HTML） */
export type GameReportPayload =
  | GameReportTextPayload
  | GameReportStructuredPayload
  | GameReportCustomPayload;

/** 第一层：纯文本模式。聊天框显示为系统消息。 */
export interface GameReportTextPayload {
  text: string;
  mode?: undefined;
}

/** 第二层：结构化数据模式。平台按 layout 选择内置模板渲染。 */
export interface GameReportStructuredPayload {
  mode: "structured";
  /** 卡片标题 */
  title?: string;
  /** 战绩数据 */
  data: GameReportScoreboardData | GameReportVersusData;
  /** 内置布局配置 */
  config?: GameReportScoreboardConfig | GameReportVersusConfig;
  /** 注入到卡片根元素的额外内联 CSS，可覆盖内置颜色/间距等 */
  style?: string;
}

// ── 子类型：计分板 (scoreboard) ──

export interface GameReportScoreboardData {
  layout: "scoreboard";
  /** 每行代表一个玩家/队伍，key 与 columns[].key 对应 */
  rows: Array<Record<string, unknown>>;
  /** 可选的汇总统计行（显示在表格下方） */
  stats?: GameReportStatCategory[];
  /** 游戏持续时长（秒） */
  duration?: number;
}

export interface GameReportScoreboardConfig {
  /** 列定义，控制显示哪些字段及格式 */
  columns: GameReportColumnDef[];
  /** 高亮前 N 名玩家（金/银/铜色），默认 3 */
  highlightTop?: number;
  /** 紧凑模式，默认 false */
  compact?: boolean;
  /** 注入到每一行的额外内联 CSS（可使用 {rowIndex} 等模板占位符） */
  rowStyle?: string;
  /** 是否显示排名序号列，默认 true */
  showRank?: boolean;
  /** 自定义排名标签生成器 key，对应 i18n（如 '#{n}'）不填则显示数字 */
  rankLabel?: string;
}

export interface GameReportColumnDef {
  /** 对应 rows 中每行的字段名 */
  key: string;
  /** 列表头标签，不填则用 key */
  label?: string;
  /** 水平对齐，默认 'left' */
  align?: "left" | "center" | "right";
  /** 列宽（如 '60px'、'1fr'），不填则自动分配 */
  width?: string;
  /** 渲染模式，默认 'text' */
  render?: "text" | "badge" | "score" | "avatar" | "playerName";
  /** 当 render === 'badge' 时，数值映射为颜色（如 { 1: 'gold', 2: 'silver' }） */
  badgeColors?: Record<string | number, string>;
}

// ── 子类型：对决 (versus) ──

export interface GameReportVersusData {
  layout: "versus";
  /** 左方/上方 */
  left: GameReportVersusSide;
  /** 右方/下方 */
  right: GameReportVersusSide;
  /** 游戏持续时长（秒） */
  duration?: number;
}

export interface GameReportVersusSide {
  /** 方名（如玩家名 / 队伍名） */
  label: string;
  /** 头像 URL（可选） */
  avatar?: string;
  /** 分数 */
  score: number | string;
  /** 是否获胜 */
  won?: boolean;
}

export interface GameReportVersusConfig {
  /** 左侧样式（CSS 注入到左方元素） */
  leftStyle?: string;
  /** 右侧样式 */
  rightStyle?: string;
  /** 比分分隔符，默认 ' : ' */
  separator?: string;
  /** 比分字号（px），默认 32 */
  scoreFontSize?: number;
}

// ── 通用 ──

export interface GameReportStatCategory {
  label: string;
  /** playerId → 该统计项的值 */
  values: Record<string, string | number>;
}

// ── 第三层：自定义 HTML/CSS ──

export interface GameReportCustomPayload {
  mode: "custom";
  /** 完整 HTML 片段（不含 <html>/<body>） */
  html: string;
  /** CSS 样式（注入到 <style> 块中），可选 */
  css?: string;
  /** 游戏实际主题，帮助平台注入合适的 color-scheme */
  theme?: "dark" | "light" | "auto";
}
