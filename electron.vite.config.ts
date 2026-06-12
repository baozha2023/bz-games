import fs from "fs";
import {resolve} from "path";
import {
    defineConfig,
    externalizeDepsPlugin,
    type UserConfig,
} from "electron-vite";
import vue from "@vitejs/plugin-vue";

type PrivateBuildConfig = {
    cdnBase?: string;
    ossBase?: string;
    marketFallbackIndexUrl?: string;
    referer?: string;
    relayServerUrl?: string;
    relayPublicHost?: string;
    relayToken?: string;
    configEncryptionSeed?: string;
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

const injectedPrivateConfig = {
    __BZ_CDN_BASE__: JSON.stringify(privateBuildConfig.cdnBase || ""),
    __BZ_OSS_BASE__: JSON.stringify(privateBuildConfig.ossBase || ""),
    __BZ_MARKET_FALLBACK_INDEX_URL__: JSON.stringify(privateBuildConfig.marketFallbackIndexUrl || ""),
    __BZ_REFERER__: JSON.stringify(privateBuildConfig.referer || ""),
    __BZ_RELAY_SERVER_URL__: JSON.stringify(privateBuildConfig.relayServerUrl || ""),
    __BZ_RELAY_PUBLIC_HOST__: JSON.stringify(privateBuildConfig.relayPublicHost || ""),
    __BZ_RELAY_TOKEN__: JSON.stringify(privateBuildConfig.relayToken || ""),
    __BZ_CONFIG_ENCRYPTION_SEED__: JSON.stringify(privateBuildConfig.configEncryptionSeed || ""),
    __BZ_OAUTH_RETURN_URL__: JSON.stringify(privateBuildConfig.oauthReturnUrl || "bzgames://oauth-complete"),
};

export default defineConfig({
    main: {
        define: injectedPrivateConfig,
        plugins: [externalizeDepsPlugin({exclude: ["electron-store"]})],
        build: {
            rollupOptions: {
                external: ['better-sqlite3']
            }
        }
    },
    preload: {
        define: injectedPrivateConfig,
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
        define: injectedPrivateConfig,
        resolve: {
            alias: {
                "@renderer": resolve("src/renderer/src"),
            },
        },
        plugins: [vue()],
    },
} as UserConfig);
