import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVATAR_FRAMES,
  getFrameImageFileName,
  normalizeAvatarFrameFileName,
  normalizeAvatarFrameId,
} from "./avatar-frames";

describe("avatar frame catalog", () => {
  it("keeps frame ids and file names unique", () => {
    const ids = AVATAR_FRAMES.map((frame) => frame.id);
    const fileNames = AVATAR_FRAMES.map((frame) => frame.imageFileName);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(fileNames).size).toBe(fileNames.length);
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
