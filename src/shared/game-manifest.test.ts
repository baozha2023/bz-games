import { describe, expect, it } from "vitest";
import { GameManifestSchema } from "./game-manifest";
import { GameType } from "./types/game.types";

function manifest(entry: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "com.example.web-game",
    name: "Web Game",
    version: "1.0.0",
    author: "Example",
    platformVersion: ">=1.0.0",
    entry,
    type: GameType.Singleplayer,
    ...(entry === "url" ? { web_url: "https://example.com/game" } : {}),
    ...overrides,
  };
}

describe("Web windowed fullscreen manifest field", () => {
  for (const entry of ["serve", "index.html", "index.htm", "url"]) {
    it(`accepts true for ${entry}`, () => {
      expect(
        GameManifestSchema.safeParse(
          manifest(entry, { windowedFullscreen: true }),
        ).success,
      ).toBe(true);
    });
  }

  it("defaults to an omitted value for existing Web manifests", () => {
    const result = GameManifestSchema.parse(manifest("serve"));
    expect(result.windowedFullscreen).toBeUndefined();
  });

  it("accepts false for Web manifests", () => {
    expect(
      GameManifestSchema.safeParse(
        manifest("serve", { windowedFullscreen: false }),
      ).success,
    ).toBe(true);
  });

  it("rejects the field for Native manifests", () => {
    const result = GameManifestSchema.safeParse(
      manifest("game.exe", { windowedFullscreen: true }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes("windowedFullscreen"),
        ),
      ).toBe(true);
    }
  });

  it.each(["true", 1, [], {}])("rejects non-boolean value %j", (value) => {
    expect(
      GameManifestSchema.safeParse(
        manifest("serve", { windowedFullscreen: value }),
      ).success,
    ).toBe(false);
  });
});
