import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const electronEntry = require.resolve("electron");
const electronExecutable = require(electronEntry);
const serviceTestSource = path.resolve("scripts/test-database-service.ts");
const serviceTestBundle = path.resolve("scripts/.test-database-service.cjs");
const serviceTestRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "bz-games-service-test-"),
);

async function main() {
  try {
    await esbuild.build({
      entryPoints: [serviceTestSource],
      outfile: serviceTestBundle,
      bundle: true,
      platform: "node",
    format: "cjs",
    external: ["better-sqlite3-multiple-ciphers"],
    define: {
      __BZ_CDN_BASE__: JSON.stringify(""),
      __BZ_OSS_BASE__: JSON.stringify(""),
      __BZ_MARKET_FALLBACK_INDEX_URL__: JSON.stringify(""),
      __BZ_REFERER__: JSON.stringify(""),
      __BZ_RELAY_SERVER_URL__: JSON.stringify(""),
      __BZ_RELAY_PUBLIC_HOST__: JSON.stringify(""),
      __BZ_RELAY_TOKEN__: JSON.stringify(""),
      __BZ_CONFIG_ENCRYPTION_SEED__: JSON.stringify(""),
      __BZ_DATABASE_ENCRYPTION_SEED__: JSON.stringify(
        "database-service-test",
      ),
      __BZ_GAME_MANIFEST_ENCRYPTION_SEED__: JSON.stringify(
        "game-manifest-service-test",
      ),
      __BZ_OAUTH_RETURN_URL__: JSON.stringify(""),
    },
      plugins: [
        {
          name: "electron-test-stub",
          setup(build) {
            build.onResolve({ filter: /^electron$/ }, () => ({
              path: "electron",
              namespace: "electron-test-stub",
            }));
            build.onLoad(
              { filter: /.*/, namespace: "electron-test-stub" },
              () => ({
                contents:
                  "export const app = { isPackaged: false, getPath: () => process.cwd(), on: () => {} };",
                loader: "js",
              }),
            );
          },
        },
      ],
    });

    const serviceResult = spawnSync(electronExecutable, [serviceTestBundle], {
      cwd: serviceTestRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
    process.exitCode = serviceResult.status ?? 1;
  } finally {
    fs.rmSync(serviceTestBundle, { force: true });
    fs.rmSync(serviceTestRoot, { recursive: true, force: true });
  }
}

void main();
