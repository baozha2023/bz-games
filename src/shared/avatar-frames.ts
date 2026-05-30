import type { AvatarFrameDef } from "./types";

export const AVATAR_FRAMES: AvatarFrameDef[] = [
  {
    id: "guofeng_ink_halo",
    name: "国风墨韵",
    description: "墨色如水，东方雅韵流转于头像之间",
    imageFileName: "Guofeng_Ink_Halo.png",
    rarity: "epic",
    unlockMethod: "consecutive_checkin",
    unlockValue: 7,
  },
  {
    id: "kawaii_macaron_loop",
    name: "马卡龙甜心",
    description: "缤纷马卡龙环绕，甜蜜可爱的少女之选",
    imageFileName: "Kawaii_Macaron_Loop.png",
    rarity: "common",
    unlockMethod: "total_checkin",
    unlockValue: 3,
  },
  {
    id: "cyberpunk_neon_ring",
    name: "赛博霓虹",
    description: "霓虹光芒跃动，赛博朋克世界的身份标志",
    imageFileName: "Cyberpunk_Neon_Ring.png",
    rarity: "rare",
    unlockMethod: "playtime",
    unlockValue: 36000000,
  },
  {
    id: "fairy_forest_vine",
    name: "精灵藤蔓",
    description: "自然之灵缠绕，森林深处精灵的呢喃",
    imageFileName: "Fairy_Forest_Vine.png",
    rarity: "rare",
    unlockMethod: "bzcoin",
    unlockValue: 200,
  },
  {
    id: "gothic_thorn_circle",
    name: "哥特荆棘",
    description: "暗黑荆棘之环，哥特美学的极致演绎",
    imageFileName: "Gothic_Thorn_Circle.png",
    rarity: "legendary",
    unlockMethod: "playtime",
    unlockValue: 180000000,
  },
  {
    id: "ocean_pearl_ring",
    name: "海洋珍珠",
    description: "深海珍珠闪烁，海洋的神秘与纯净之美",
    imageFileName: "Ocean_Pearl_Ring.png",
    rarity: "common",
    unlockMethod: "total_checkin",
    unlockValue: 10,
  },
  {
    id: "astrology_moon_phase",
    name: "星象月相",
    description: "星辰轨迹环绕，宇宙的奥秘在头像间流转",
    imageFileName: "Astrology_Moon_Phase.png",
    rarity: "rare",
    unlockMethod: "bzcoin",
    unlockValue: 300,
  },
  {
    id: "autumn_maple_twig",
    name: "秋枫如火",
    description: "秋日枫叶飘落，岁月静好的温柔色彩",
    imageFileName: "Autumn_Maple_Twig.png",
    rarity: "epic",
    unlockMethod: "playtime",
    unlockValue: 72000000,
  },
];

export function getFrameImageFileName(frameId: string): string | undefined {
  return AVATAR_FRAMES.find((f) => f.id === frameId)?.imageFileName;
}
