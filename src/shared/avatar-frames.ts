import type { AvatarFrameDef } from "./types";

export const AVATAR_FRAMES: AvatarFrameDef[] = [
  {
    id: "guofeng_ink_halo",
    name: "国风墨韵",
    description: "墨色如水，东方雅韵流转于头像之间",
    imageFileName: "Guofeng_Ink_Halo.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "epic",
    unlock: { type: "consecutive_checkin", days: 7 },
  },
  {
    id: "kawaii_macaron_loop",
    name: "马卡龙甜心",
    description: "缤纷马卡龙环绕，甜蜜可爱的少女之选",
    imageFileName: "Kawaii_Macaron_Loop.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "common",
    unlock: { type: "total_checkin", days: 3 },
  },
  {
    id: "cyberpunk_neon_ring",
    name: "赛博霓虹",
    description: "霓虹光芒跃动，赛博朋克世界的身份标志",
    imageFileName: "Cyberpunk_Neon_Ring.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "rare",
    unlock: { type: "playtime", durationMs: 36000000 },
  },
  {
    id: "fairy_forest_vine",
    name: "精灵藤蔓",
    description: "自然之灵缠绕，森林深处精灵的呢喃",
    imageFileName: "Fairy_Forest_Vine.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "rare",
    unlock: { type: "bzcoin", amount: 200 },
  },
  {
    id: "gothic_thorn_circle",
    name: "哥特荆棘",
    description: "暗黑荆棘之环，哥特美学的极致演绎",
    imageFileName: "Gothic_Thorn_Circle.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "legendary",
    unlock: { type: "playtime", durationMs: 180000000 },
  },
  {
    id: "ocean_pearl_ring",
    name: "海洋珍珠",
    description: "深海珍珠闪烁，海洋的神秘与纯净之美",
    imageFileName: "Ocean_Pearl_Ring.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "common",
    unlock: { type: "total_checkin", days: 10 },
  },
  {
    id: "astrology_moon_phase",
    name: "星象月相",
    description: "星辰轨迹环绕，宇宙的奥秘在头像间流转",
    imageFileName: "Astrology_Moon_Phase.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "rare",
    unlock: { type: "bzcoin", amount: 300 },
  },
  {
    id: "autumn_maple_twig",
    name: "秋枫如火",
    description: "秋日枫叶飘落，岁月静好的温柔色彩",
    imageFileName: "Autumn_Maple_Twig.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "epic",
    unlock: { type: "playtime", durationMs: 72000000 },
  },
  {
    id: "starry_compass",
    name: "星河罗盘",
    description: "深蓝星轨与鎏金罗盘交织，指引穿越群星的方向",
    imageFileName: "Starry_Compass.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "epic",
    unlock: { type: "playtime", durationMs: 360000000 },
  },
  {
    id: "jade_bamboo_clouds",
    name: "青竹流云",
    description: "青竹环翠，祥云舒卷，藏一份东方雅意",
    imageFileName: "Jade_Bamboo_Clouds.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "rare",
    unlock: { type: "consecutive_checkin", days: 14 },
  },
  {
    id: "molten_gold_movement",
    name: "熔金机芯",
    description: "黄铜齿轮精密咬合，红晶映照不息的机械心脏",
    imageFileName: "Molten_Gold_Movement.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "legendary",
    unlock: { type: "bzcoin", amount: 500 },
  },
  {
    id: "frost_crown",
    name: "霜华王冠",
    description: "银蓝霜纹凝成冠冕，静候冬日荣光加冕",
    imageFileName: "Frost_Crown.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "rare",
    unlock: { type: "total_checkin", days: 30 },
  },
  {
    id: "kintsugi_moon_ring",
    name: "金缮月轮",
    description: "素瓷历经裂变，以漆与金重新连缀成月",
    imageFileName: "Kintsugi_Moon_Ring.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "epic",
    unlock: { type: "total_checkin", days: 60 },
  },
  {
    id: "pixel_warp",
    name: "像素跃迁",
    description: "霓虹像素构成跃迁通道，通往八比特之外的世界",
    imageFileName: "Pixel_Warp.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "epic",
    unlock: { type: "playtime", durationMs: 720000000 },
  },
  {
    id: "spring_kite_letter",
    name: "纸鸢春信",
    description: "纸鸢、流云与同心结，捎来一封明快春信",
    imageFileName: "Spring_Kite_Letter.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "rare",
    unlock: { type: "consecutive_checkin", days: 30 },
  },
  {
    id: "ember_dragonspine",
    name: "龙脊余烬",
    description: "黑曜龙鳞封存熔火，余烬仍沿古老脊线流淌",
    imageFileName: "Ember_Dragonspine.png",
    contentInsetPx: { top: 60, right: 60, bottom: 60, left: 60 },
    rarity: "legendary",
    unlock: { type: "bzcoin", amount: 800 },
  },
];

const AVATAR_FRAME_BY_ID = new Map(
  AVATAR_FRAMES.map((frame) => [frame.id, frame] as const),
);

const AVATAR_FRAME_FILE_NAMES = new Set(
  AVATAR_FRAMES.map((frame) => frame.imageFileName),
);

export function normalizeAvatarFrameId(value: unknown): string | undefined {
  return typeof value === "string" && AVATAR_FRAME_BY_ID.has(value)
    ? value
    : undefined;
}

export function normalizeAvatarFrameFileName(
  value: unknown,
): string | undefined {
  return typeof value === "string" && AVATAR_FRAME_FILE_NAMES.has(value)
    ? value
    : undefined;
}

export function getFrameImageFileName(frameId: unknown): string | undefined {
  const normalizedFrameId = normalizeAvatarFrameId(frameId);
  return normalizedFrameId
    ? AVATAR_FRAME_BY_ID.get(normalizedFrameId)?.imageFileName
    : undefined;
}

export function getAvatarFrameByFileName(
  fileName: unknown,
): AvatarFrameDef | undefined {
  const normalizedFileName = normalizeAvatarFrameFileName(fileName);
  return normalizedFileName
    ? AVATAR_FRAMES.find((frame) => frame.imageFileName === normalizedFileName)
    : undefined;
}
