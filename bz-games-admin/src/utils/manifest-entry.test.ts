import { describe, expect, it } from "vitest";
import {
  buildEntrySpecificManifestFields,
  getManifestEntryKind,
  validateManifestRuntimeRelations,
} from "./manifest-entry";

describe("Manifest entry-specific fields", () => {
  it.each(["serve", "url", "index.html", "game.HTM"])(
    "classifies %s as Web",
    (entry) => {
      expect(getManifestEntryKind(entry)).toBe("web");
    },
  );

  it("classifies native entry and empty entry correctly", () => {
    expect(getManifestEntryKind("game.exe")).toBe("native");
    expect(getManifestEntryKind(" ")).toBe("unknown");
  });

  it("keeps only the Web window option for Web entries", () => {
    expect(
      buildEntrySpecificManifestFields({
        entry: "serve",
        windowedFullscreen: true,
        args: ["--should-not-be-submitted"],
        env: { SHOULD_NOT_BE_SUBMITTED: "1" },
      }),
    ).toEqual({ windowedFullscreen: true });
  });

  it("keeps args and env only for Native entries", () => {
    expect(
      buildEntrySpecificManifestFields({
        entry: "game.exe",
        windowedFullscreen: true,
        args: ["--example"],
        env: { EXAMPLE: "1" },
      }),
    ).toEqual({ args: ["--example"], env: { EXAMPLE: "1" } });
  });

  it("does not submit entry-specific fields before entry is configured", () => {
    expect(
      buildEntrySpecificManifestFields({
        entry: "",
        windowedFullscreen: true,
        args: ["--example"],
        env: { EXAMPLE: "1" },
      }),
    ).toEqual({});
  });

  it("enforces the same runtime relations as the desktop manifest schema", () => {
    expect(
      validateManifestRuntimeRelations({
        entry: "url",
        webUrl: "",
        type: "networkgame",
      }),
    ).toBe("web_url_required");
    expect(
      validateManifestRuntimeRelations({
        entry: "game.exe",
        webUrl: "https://example.com",
        type: "singleplayer",
      }),
    ).toBe("web_url_forbidden");
    expect(
      validateManifestRuntimeRelations({
        entry: "game.exe",
        webUrl: "",
        type: "multiplayer",
      }),
    ).toBe("multiplayer_required");
    expect(
      validateManifestRuntimeRelations({
        entry: "game.exe",
        webUrl: "",
        type: "singleplayer",
        encryptLocalStorage: true,
      }),
    ).toBe("encrypt_local_storage_forbidden");
    expect(
      validateManifestRuntimeRelations({
        entry: "serve",
        webUrl: "",
        type: "singleplayer",
      }),
    ).toBeNull();
  });
});
