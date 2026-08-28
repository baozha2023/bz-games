import { describe, expect, it } from "vitest";
import {
  GameManifestV1Schema,
  parseGameManifest,
  resolveGameManifest,
} from "./game-manifest";
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
        GameManifestV1Schema.safeParse(
          manifest(entry, { windowedFullscreen: true }),
        ).success,
      ).toBe(true);
    });
  }

  it("defaults to an omitted value for existing Web manifests", () => {
    const result = GameManifestV1Schema.parse(manifest("serve"));
    expect(result.windowedFullscreen).toBeUndefined();
  });

  it("accepts false for Web manifests", () => {
    expect(
      GameManifestV1Schema.safeParse(
        manifest("serve", { windowedFullscreen: false }),
      ).success,
    ).toBe(true);
  });

  it("rejects the field for Native manifests", () => {
    const result = GameManifestV1Schema.safeParse(
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
      GameManifestV1Schema.safeParse(
        manifest("serve", { windowedFullscreen: value }),
      ).success,
    ).toBe(false);
  });
});

function manifestV2(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: 2,
    id: "com.example.localized-game",
    version: "1.0.0",
    defaultLocale: "zh-CN",
    localizations: {
      "zh-CN": {
        name: "本地化游戏",
        description: "默认简介",
        achievements: {
          first_win: { title: "初次胜利", description: "赢得第一局" },
        },
        statistics: { score: "得分" },
      },
      "en-US": {
        name: "Localized Game",
        description: "English description",
        achievements: {
          first_win: { title: "First Win", description: "Win a game" },
        },
        statistics: { score: "Score" },
      },
    },
    author: "Example",
    platformVersion: ">=4.0.0",
    entry: "game.exe",
    type: GameType.Singleplayer,
    statistics: [{ id: "score", mode: "full" }],
    achievements: [{ id: "first_win", icon: "assets/win.png" }],
    ...overrides,
  };
}

describe("Game Manifest V1/V2", () => {
  it.each([undefined, 1, 3, "2"])(
    "routes manifestVersion=%j through V1",
    (manifestVersion) => {
      const raw = manifest("game.exe", { manifestVersion });
      const parsed = parseGameManifest(raw);
      expect("defaultLocale" in parsed).toBe(false);
      expect(resolveGameManifest(parsed, "en-US").name).toBe("Web Game");
    },
  );

  it("resolves one complete requested language bundle", () => {
    const resolved = resolveGameManifest(
      parseGameManifest(manifestV2()),
      "en-US",
    );
    expect(resolved).toMatchObject({
      manifestVersion: 2,
      resolvedLocale: "en-US",
      name: "Localized Game",
      description: "English description",
      achievements: [
        { id: "first_win", title: "First Win", description: "Win a game" },
      ],
      statistics: [{ score: { label: "Score", mode: "full" } }],
    });
  });

  it("falls back to the complete default bundle when a locale is absent", () => {
    const resolved = resolveGameManifest(
      parseGameManifest(manifestV2()),
      "ja-JP",
    );
    expect(resolved.resolvedLocale).toBe("zh-CN");
    expect(resolved.name).toBe("本地化游戏");
    expect(resolved.achievements?.[0].title).toBe("初次胜利");
    expect(resolved.statistics?.[0]).toEqual({
      score: { label: "得分", mode: "full" },
    });
  });

  it("rejects a missing default language and incomplete language bundles", () => {
    expect(() =>
      parseGameManifest(
        manifestV2({
          defaultLocale: "ja-JP",
        }),
      ),
    ).toThrow();

    const invalid = manifestV2();
    delete (invalid.localizations["en-US"].statistics as Record<string, string>)
      .score;
    expect(() => parseGameManifest(invalid)).toThrow();
  });

  it("rejects duplicate IDs, dangerous IDs and V1 display fields in V2", () => {
    expect(() =>
      parseGameManifest(
        manifestV2({
          statistics: [
            { id: "score", mode: "full" },
            { id: "score", mode: "increment" },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseGameManifest(manifestV2({ achievements: [{ id: "__proto__" }] })),
    ).toThrow();
    expect(() =>
      parseGameManifest({ ...manifestV2(), name: "legacy" }),
    ).toThrow();
  });
});
