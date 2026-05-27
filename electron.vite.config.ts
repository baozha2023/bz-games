import {resolve} from "path";
import {
    defineConfig,
    externalizeDepsPlugin,
    type UserConfig,
} from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin({exclude: ["electron-store"]})],
        build: {
            rollupOptions: {
                external: ['better-sqlite3']
            }
        }
    },
    preload: {
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
        resolve: {
            alias: {
                "@renderer": resolve("src/renderer/src"),
            },
        },
        plugins: [vue()],
    },
} as UserConfig);
