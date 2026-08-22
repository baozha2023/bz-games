import { describe, expect, it } from "vitest";
import { buildDesktopReleaseUrl } from "./update-release";

describe("buildDesktopReleaseUrl", () => {
  it("opens the detected stable release", () => {
    expect(buildDesktopReleaseUrl("3.2.3")).toBe(
      "https://github.com/baozha2023/bz-games/releases/tag/v3.2.3",
    );
  });

  it("normalizes a version that already has a v prefix", () => {
    expect(buildDesktopReleaseUrl("v3.2.3")).toBe(
      "https://github.com/baozha2023/bz-games/releases/tag/v3.2.3",
    );
  });

  it.each([
    undefined,
    "",
    "not-a-version",
    "3.2.3-beta.1",
    "3.2.3+build.1",
  ]) (
    "falls back to the latest release for %s",
    (version) => {
      expect(buildDesktopReleaseUrl(version)).toBe(
        "https://github.com/baozha2023/bz-games/releases/latest",
      );
    },
  );
});
