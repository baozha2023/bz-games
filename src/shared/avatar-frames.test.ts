import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVATAR_FRAMES,
  getAvatarFrameByFileName,
  getFrameImageFileName,
  normalizeAvatarFrameFileName,
  normalizeAvatarFrameId,
} from "./avatar-frames";

describe("avatar frame catalog", () => {
  const expectedContentInsetByFile: Record<string, number> = {
    "Guofeng_Ink_Halo.png": 46,
    "Kawaii_Macaron_Loop.png": 42,
    "Cyberpunk_Neon_Ring.png": 41,
    "Fairy_Forest_Vine.png": 41,
    "Gothic_Thorn_Circle.png": 43,
    "Ocean_Pearl_Ring.png": 46,
    "Astrology_Moon_Phase.png": 60,
    "Autumn_Maple_Twig.png": 42,
    "Starry_Compass.png": 38,
    "Jade_Bamboo_Clouds.png": 38,
    "Molten_Gold_Movement.png": 38,
    "Frost_Crown.png": 38,
    "Kintsugi_Moon_Ring.png": 38,
    "Pixel_Warp.png": 38,
    "Spring_Kite_Letter.png": 38,
    "Ember_Dragonspine.png": 38,
  };

  it("keeps frame ids and file names unique", () => {
    const ids = AVATAR_FRAMES.map((frame) => frame.id);
    const fileNames = AVATAR_FRAMES.map((frame) => frame.imageFileName);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  it("uses only manual unlock conditions", () => {
    expect(
      AVATAR_FRAMES.every((frame) =>
        [
          "bzcoin",
          "playtime",
          "total_checkin",
          "consecutive_checkin",
        ].includes(frame.unlock.type),
      ),
    ).toBe(true);
    expect(AVATAR_FRAMES.every((frame) => Boolean(frame.unlock))).toBe(true);
  });

  it("keeps every catalog image present in the packaged resource directory", () => {
    for (const frame of AVATAR_FRAMES) {
      expect(
        fs.existsSync(
          path.join(
            process.cwd(),
            "resources",
            "avatar-frames",
            frame.imageFileName,
          ),
        ),
        `missing avatar frame image: ${frame.imageFileName}`,
      ).toBe(true);
    }
  });

  it.each(AVATAR_FRAMES)("normalizes $id", (frame) => {
    expect(normalizeAvatarFrameId(frame.id)).toBe(frame.id);
    expect(normalizeAvatarFrameFileName(frame.imageFileName)).toBe(
      frame.imageFileName,
    );
    expect(getFrameImageFileName(frame.id)).toBe(frame.imageFileName);
    expect(getAvatarFrameByFileName(frame.imageFileName)).toBe(frame);
    const expectedInset = expectedContentInsetByFile[frame.imageFileName];
    expect(expectedInset).toBeDefined();
    expect(frame.contentInsetPx).toEqual({
      top: expectedInset,
      right: expectedInset,
      bottom: expectedInset,
      left: expectedInset,
    });
  });

  it.each(["removed-frame", "../frame.png", "", null, undefined, 1])(
    "rejects invalid frame identity %s",
    (value) => {
      expect(normalizeAvatarFrameId(value)).toBeUndefined();
      expect(getFrameImageFileName(value)).toBeUndefined();
    },
  );

  it.each(["Old_Frame.png", "../Starry_Compass.png", "", null, undefined, 1])(
    "rejects invalid frame file %s",
    (value) => {
      expect(normalizeAvatarFrameFileName(value)).toBeUndefined();
    },
  );
});
