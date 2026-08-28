import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppStore } from "../../../shared/types";

describe("ConfigCodec v4", () => {
  let createDefaultV4Store: (typeof import("./ConfigCodec"))["createDefaultV4Store"];
  let serializeV4Config: (typeof import("./ConfigCodec"))["serializeV4Config"];
  let deserializeV4Config: (typeof import("./ConfigCodec"))["deserializeV4Config"];
  let CONFIG_MAX_SERIALIZED_BYTES: number;

  beforeAll(async () => {
    for (const name of [
      "__BZ_CDN_BASE__",
      "__BZ_OSS_BASE__",
      "__BZ_MARKET_OSS_INDEX_URL__",
      "__BZ_REFERER__",
      "__BZ_RELAY_SERVER_URL__",
      "__BZ_RELAY_PUBLIC_HOST__",
      "__BZ_RELAY_TOKEN__",
      "__BZ_DATABASE_ENCRYPTION_SEED__",
      "__BZ_GAME_MANIFEST_ENCRYPTION_SEED__",
      "__BZ_OAUTH_RETURN_URL__",
    ]) {
      vi.stubGlobal(name, "");
    }
    vi.stubGlobal("__BZ_CONFIG_ENCRYPTION_SEED__", "config-codec-test-seed");
    ({
      createDefaultV4Store,
      serializeV4Config,
      deserializeV4Config,
      CONFIG_MAX_SERIALIZED_BYTES,
    } = await import("./ConfigCodec"));
  });

  it("round-trips the strict v4 store envelope", () => {
    const store = createDefaultV4Store();
    store.settings.playerId = "player-id";
    const serialized = serializeV4Config(store);
    expect(deserializeV4Config(serialized)).toEqual(store);
  });

  it("rejects unknown envelope fields", () => {
    const envelope = JSON.parse(
      serializeV4Config(createDefaultV4Store()),
    ) as Record<string, unknown>;
    envelope.unexpected = true;
    expect(() => deserializeV4Config(JSON.stringify(envelope))).toThrow(
      "config_v4_envelope_invalid",
    );
  });

  it("rejects malformed or non-canonical encrypted fields", () => {
    const envelope = JSON.parse(
      serializeV4Config(createDefaultV4Store()),
    ) as Record<string, unknown>;
    envelope.iv = "AA==";
    expect(() => deserializeV4Config(JSON.stringify(envelope))).toThrow(
      "config_decrypt_failed",
    );
  });

  it("rejects oversized input before parsing or decrypting", () => {
    expect(() =>
      deserializeV4Config("x".repeat(CONFIG_MAX_SERIALIZED_BYTES + 1)),
    ).toThrow("config_too_large");
  });

  it("rejects stores with unknown payload fields before encryption", () => {
    const store = createDefaultV4Store() as AppStore & {
      unexpected?: boolean;
    };
    store.unexpected = true;
    expect(() => serializeV4Config(store)).toThrow();
  });
});
