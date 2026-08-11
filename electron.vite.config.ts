import fs from "fs";
import { resolve } from "path";
import {
  defineConfig,
  externalizeDepsPlugin,
  type UserConfig,
} from "electron-vite";
import vue from "@vitejs/plugin-vue";

type PrivateBuildConfig = {
  cdnBase?: string;
  ossBase?: string;
  marketOssIndexUrl?: string;
  referer?: string;
  relayServerUrl?: string;
  relayPublicHost?: string;
  relayToken?: string;
  configEncryptionSeed?: string;
  databaseEncryptionSeed?: string;
  gameManifestEncryptionSeed?: string;
  oauthReturnUrl?: string;
};

const privateConfigPath = resolve("private-build.config.json");

function readPrivateBuildConfig(): PrivateBuildConfig {
  if (!fs.existsSync(privateConfigPath)) return {};
  const raw = fs.readFileSync(privateConfigPath, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

const privateBuildConfig = readPrivateBuildConfig();

function requireEncryptionSeed(configKey: string, value?: string): string {
  const seed = value?.trim() || "";
  let decoded: Buffer;
  try {
    decoded = Buffer.from(seed, "base64");
  } catch {
    decoded = Buffer.alloc(0);
  }
  const canonical = decoded.toString("base64");
  if (decoded.length !== 32 || canonical !== seed) {
    throw new Error(
      `[BZ-Games] private-build.config.json must define ${configKey} ` +
        "as a canonical Base64 value containing exactly 32 random bytes.",
    );
  }
  return seed;
}

const databaseEncryptionSeed = requireEncryptionSeed(
  "databaseEncryptionSeed",
  privateBuildConfig.databaseEncryptionSeed,
);
const gameManifestEncryptionSeed = requireEncryptionSeed(
  "gameManifestEncryptionSeed",
  privateBuildConfig.gameManifestEncryptionSeed,
);

const injectedPrivateConfig = {
  __BZ_CDN_BASE__: JSON.stringify(privateBuildConfig.cdnBase || ""),
  __BZ_OSS_BASE__: JSON.stringify(privateBuildConfig.ossBase || ""),
  __BZ_MARKET_OSS_INDEX_URL__: JSON.stringify(
    privateBuildConfig.marketOssIndexUrl || "",
  ),
  __BZ_REFERER__: JSON.stringify(privateBuildConfig.referer || ""),
  __BZ_RELAY_SERVER_URL__: JSON.stringify(
    privateBuildConfig.relayServerUrl || "",
  ),
  __BZ_RELAY_PUBLIC_HOST__: JSON.stringify(
    privateBuildConfig.relayPublicHost || "",
  ),
  __BZ_RELAY_TOKEN__: JSON.stringify(privateBuildConfig.relayToken || ""),
  __BZ_CONFIG_ENCRYPTION_SEED__: JSON.stringify(
    privateBuildConfig.configEncryptionSeed || "",
  ),
  __BZ_DATABASE_ENCRYPTION_SEED__: JSON.stringify(databaseEncryptionSeed),
  __BZ_GAME_MANIFEST_ENCRYPTION_SEED__: JSON.stringify(
    gameManifestEncryptionSeed,
  ),
  __BZ_OAUTH_RETURN_URL__: JSON.stringify(
    privateBuildConfig.oauthReturnUrl || "bzgames://oauth-complete",
  ),
};

const injectedNonMainConfig = {
  ...injectedPrivateConfig,
  __BZ_GAME_MANIFEST_ENCRYPTION_SEED__: JSON.stringify(""),
};

export default defineConfig({
  main: {
    define: injectedPrivateConfig,
    plugins: [externalizeDepsPlugin({ exclude: ["electron-store"] })],
    build: {
      rollupOptions: {
        external: ["better-sqlite3-multiple-ciphers"],
      },
    },
  },
  preload: {
    define: injectedNonMainConfig,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          game: resolve("src/preload/game.ts"),
        },
      },
    },
  },
  renderer: {
    define: injectedNonMainConfig,
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [vue()],
  },
} as UserConfig);
