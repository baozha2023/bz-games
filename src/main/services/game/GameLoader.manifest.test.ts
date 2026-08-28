import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "4.0.0",
  },
}));

vi.mock("../../../shared/AppConstants", () => ({
  GAME_MANIFEST_ENCRYPTION_SEED:
    "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const storageMocks = vi.hoisted(() => ({
  storagePath: "",
}));

vi.mock("../storage/StoreService", () => ({
  storeService: {
    getGames: async () => [],
    getSettings: () => ({ language: "zh-CN" }),
    getDefaultGameStoragePath: () => storageMocks.storagePath,
    getGameVersionLocation: () => ({
      libraryId: "default",
      relativePath: "local.game.go/1.0.0",
    }),
    addGame: async () => undefined,
  },
}));

import { GameLoader } from "./GameLoader";
import {
  GameManifestFileError,
  readGameManifestFile,
  writeEncryptedGameManifestFile,
} from "./GameManifestFileService";
import type { GameManifest } from "../../../shared/game-manifest";
import { GameType } from "../../../shared/types";

const manifest: GameManifest = {
  id: "local.game.go",
  name: "围棋",
  version: "1.0.0",
  author: "tester",
  platformVersion: ">=1.0.0",
  entry: "index.html",
  type: GameType.Singleplayer,
};

function plaintextManifestJson(): string {
  return JSON.stringify(manifest, null, 2);
}

function foreignKeyEnvelopeJson(): string {
  return JSON.stringify({
    __bzGameManifestEncrypted: true,
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: "0123456789abcdef",
    iv: Buffer.alloc(12).toString("base64"),
    tag: Buffer.alloc(16).toString("base64"),
    payload: Buffer.from("payload").toString("base64"),
  });
}

async function expectGameManifestFileError(
  action: () => unknown,
  code: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(GameManifestFileError);
  expect((thrown as GameManifestFileError).code).toBe(code);
}

describe("GameManifestFileService", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "bz-manifest-file-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips an encrypted manifest", async () => {
    const manifestPath = path.join(root, "game.json");
    writeEncryptedGameManifestFile(manifestPath, manifest);

    expect(readGameManifestFile(manifestPath)).toEqual(manifest);

    const envelope = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(envelope.__bzGameManifestEncrypted).toBe(true);
    expect(envelope.id).toBeUndefined();
  });

  it("rejects a plaintext manifest with manifestPlaintextUnsupported", async () => {
    const manifestPath = path.join(root, "game.json");
    await writeFile(manifestPath, plaintextManifestJson(), "utf8");

    await expectGameManifestFileError(
      () => readGameManifestFile(manifestPath),
      "manifestPlaintextUnsupported",
    );
  });

  it("rejects an envelope encrypted with a different key", async () => {
    const manifestPath = path.join(root, "game.json");
    await writeFile(manifestPath, foreignKeyEnvelopeJson(), "utf8");

    await expectGameManifestFileError(
      () => readGameManifestFile(manifestPath),
      "manifestKeyMismatch",
    );
  });
});

describe("GameLoader manifest import", () => {
  let root: string;
  let sourceDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "bz-loader-manifest-test-"));
    sourceDir = path.join(root, "go-game");
    await mkdir(sourceDir);
    await writeFile(path.join(sourceDir, "index.html"), "<html></html>", "utf8");
    await writeFile(
      path.join(sourceDir, "game.json"),
      plaintextManifestJson(),
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prepares an import from a plaintext game.json without rewriting the source file", async () => {
    const prepared = await GameLoader.prepareGameImport(sourceDir);

    expect(prepared.manifest.id).toBe("local.game.go");
    expect(prepared.manifest.version).toBe("1.0.0");

    const after = await readFile(path.join(sourceDir, "game.json"), "utf8");
    expect(after).toBe(plaintextManifestJson());
    expect(after).not.toContain("__bzGameManifestEncrypted");
  });

  it("prepares an import from an encrypted game.json", async () => {
    writeEncryptedGameManifestFile(
      path.join(sourceDir, "game.json"),
      manifest,
    );

    const prepared = await GameLoader.prepareGameImport(sourceDir);

    expect(prepared.manifest.id).toBe("local.game.go");
  });

  it("maps an invalid plaintext manifest to manifestInvalid", async () => {
    await writeFile(
      path.join(sourceDir, "game.json"),
      JSON.stringify({ ...manifest, id: "no" }),
      "utf8",
    );

    await expect(GameLoader.prepareGameImport(sourceDir)).rejects.toMatchObject(
      {
        code: "manifestInvalid",
      },
    );
  });

  it("keeps rejecting encrypted manifests from another build key", async () => {
    await writeFile(
      path.join(sourceDir, "game.json"),
      foreignKeyEnvelopeJson(),
      "utf8",
    );

    await expect(GameLoader.prepareGameImport(sourceDir)).rejects.toMatchObject(
      {
        code: "manifestKeyMismatch",
      },
    );
  });

  it("installs a plaintext source with an encrypted manifest in the library", async () => {
    storageMocks.storagePath = path.join(root, "games");

    const result = await GameLoader.loadGameFromPath(sourceDir, {
      installSource: "manual",
      marketId: null,
    });

    expect(result.success).toBe(true);
    expect(result.manifest?.id).toBe("local.game.go");

    const installedPath = path.join(
      storageMocks.storagePath,
      "local.game.go",
      "1.0.0",
      "game.json",
    );
    const envelope = JSON.parse(await readFile(installedPath, "utf8"));
    expect(envelope.__bzGameManifestEncrypted).toBe(true);
    expect(envelope.id).toBeUndefined();

    const after = await readFile(path.join(sourceDir, "game.json"), "utf8");
    expect(after).toBe(plaintextManifestJson());
  });
});
