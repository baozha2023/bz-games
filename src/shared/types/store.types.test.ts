import { describe, expect, it } from "vitest";
import { NICKNAME_EFFECTS, normalizeNicknameEffect } from "./store.types";

describe("nickname effects", () => {
  it("keeps a unique, intentional effect catalog", () => {
    expect(new Set(NICKNAME_EFFECTS).size).toBe(NICKNAME_EFFECTS.length);
    expect(NICKNAME_EFFECTS).toEqual([
      "none",
      "glow",
      "flame",
      "neon",
      "aurora",
      "crystal",
      "comet",
      "heartbeat",
      "hologram",
      "inkflow",
      "eclipse",
    ]);
  });

  it.each(NICKNAME_EFFECTS)("preserves supported effect %s", (effect) => {
    expect(normalizeNicknameEffect(effect)).toBe(effect);
  });

  it.each(["sparkle", "rainbow", "stardust", "unknown", null, undefined])(
    "normalizes removed or invalid effect %s",
    (effect) => {
      expect(normalizeNicknameEffect(effect)).toBe("none");
    },
  );
});
