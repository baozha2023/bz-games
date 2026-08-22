import type { GameCardProductDef } from "./types";

export const GAME_CARD_PRODUCTS: GameCardProductDef[] = [
  {
    id: "jade_glow",
    name: "青玉流光",
    description: "玉色流光与金丝交织，映出一抹清雅的东方灵韵。",
    assets: {
      square: {
        fileName: "square.png",
        contentInsetPercent: { top: 5, right: 4, bottom: 5, left: 4 },
      },
      wide: {
        fileName: "wide.png",
        contentInsetPercent: { top: 2, right: 4, bottom: 2, left: 4 },
      },
    },
    unlock: { type: "bzcoin", amount: 240 },
  },
  {
    id: "spring_kite",
    name: "春日纸鸢",
    description: "纸鸢乘风，春色入画，赠给坚持签到的每一个日子。",
    assets: {
      square: {
        fileName: "square.png",
        contentInsetPercent: { top: 5, right: 4, bottom: 5, left: 4 },
      },
      wide: {
        fileName: "wide.png",
        contentInsetPercent: { top: 2, right: 4, bottom: 2, left: 4 },
      },
    },
    unlock: { type: "consecutive_checkin", days: 7 },
  },
  {
    id: "spring_fortune_2027",
    name: "新春瑞火·2027",
    description: "灯火、烟花与瑞云同庆，记录 2027 年的新春游时。",
    assets: {
      square: {
        fileName: "square.png",
        contentInsetPercent: { top: 5, right: 4, bottom: 5, left: 4 },
      },
      wide: {
        fileName: "wide.png",
        contentInsetPercent: { top: 2, right: 4, bottom: 2, left: 4 },
      },
    },
    unlock: {
      type: "date_playtime",
      date: "2027-02-06",
      durationMs: 45 * 60 * 1000,
    },
  },
];

const GAME_CARD_PRODUCT_BY_ID = new Map(
  GAME_CARD_PRODUCTS.map((product) => [product.id, product] as const),
);

export function getGameCardProduct(productId: unknown): GameCardProductDef | undefined {
  return typeof productId === "string"
    ? GAME_CARD_PRODUCT_BY_ID.get(productId)
    : undefined;
}

export function getGameCardProductAsset(
  productId: unknown,
  ratio: "square" | "wide",
){
  const product = getGameCardProduct(productId);
  return product?.assets[ratio];
}
