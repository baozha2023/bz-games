import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GAME_CARD_PRODUCTS,
  getGameCardProduct,
  getGameCardProductAsset,
} from "./game-card-products";

describe("game card product catalog", () => {
  it("contains the fixed products and unique ids", () => {
    expect(GAME_CARD_PRODUCTS).toHaveLength(3);
    const ids = GAME_CARD_PRODUCTS.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getGameCardProduct("jade_glow")?.unlock).toEqual({
      type: "bzcoin",
      amount: 240,
    });
    expect(getGameCardProduct("spring_kite")?.unlock).toEqual({
      type: "consecutive_checkin",
      days: 7,
    });
    expect(getGameCardProduct("spring_fortune_2027")?.unlock).toEqual({
      type: "date_playtime",
      date: "2027-02-06",
      durationMs: 45 * 60 * 1000,
    });
  });

  it("keeps both packaged image ratios for every product", () => {
    for (const product of GAME_CARD_PRODUCTS) {
      for (const ratio of ["square", "wide"] as const) {
        const asset = getGameCardProductAsset(product.id, ratio);
        expect(asset).toBeDefined();
        expect(asset?.fileName).toBe(`${ratio}.png`);
        expect(
          fs.existsSync(
            path.join(
              process.cwd(),
              "resources",
              "game-card-products",
              product.id,
              asset?.fileName as string,
            ),
          ),
          `missing ${ratio} game card product image: ${product.id}`,
        ).toBe(true);
      }
    }
  });

  it.each(["unknown", "../jade_glow", "", null, undefined, 1])(
    "rejects invalid product identity %s",
    (value) => {
      expect(getGameCardProduct(value)).toBeUndefined();
      expect(getGameCardProductAsset(value, "square")).toBeUndefined();
    },
  );
});
