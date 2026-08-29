import path from "path";
import { describe, expect, it } from "vitest";

import { normalizeUninstallStorageRoots } from "./UninstallPathSafety";

describe("normalizeUninstallStorageRoots", () => {
  it("normalizes and de-duplicates game library roots", () => {
    const result = normalizeUninstallStorageRoots(
      [String.raw`D:\Games`, "d:\\games\\"],
      String.raw`C:\BZ-Games`,
      [String.raw`C:\Users\tester`],
    );

    expect(result).toEqual([path.resolve(String.raw`D:\Games`)]);
  });

  it("rejects a library that contains the installation", () => {
    expect(() =>
      normalizeUninstallStorageRoots(["C:\\"], String.raw`C:\BZ-Games`, []),
    ).toThrow("unsafe_game_storage_path");
  });

  it("rejects a protected path", () => {
    expect(() =>
      normalizeUninstallStorageRoots(
        [String.raw`C:\Users\tester`],
        String.raw`D:\BZ-Games`,
        [String.raw`C:\Users\tester`],
      ),
    ).toThrow("unsafe_game_storage_path");
  });

  it("rejects a library that contains a protected path", () => {
    expect(() =>
      normalizeUninstallStorageRoots(
        [String.raw`C:\Users`],
        String.raw`D:\BZ-Games`,
        [String.raw`C:\Users\tester`],
      ),
    ).toThrow("unsafe_game_storage_path");
  });
});
