import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const privateConfig = JSON.parse(
  fs.readFileSync(path.resolve("private-build.config.json"), "utf8"),
);
const bundle = path.resolve("scripts/.validate-v1-conversion.cjs");
const fixtureMode = process.argv.includes("--fixture");
const [archivePath, outputRoot] = process.argv
  .slice(2)
  .filter((argument) => argument !== "--fixture");
if (!archivePath || !outputRoot) {
  throw new Error("usage: node scripts/run-v1-conversion.mjs <archive> <output>");
}

try {
  await esbuild.build({
    entryPoints: [path.resolve("scripts/validate-v1-conversion.ts")],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["better-sqlite3-multiple-ciphers", "7zip-bin"],
    define: {
      __BZ_CDN_BASE__: JSON.stringify(""),
      __BZ_OSS_BASE__: JSON.stringify(""),
      __BZ_MARKET_OSS_INDEX_URL__: JSON.stringify(""),
      __BZ_REFERER__: JSON.stringify(""),
      __BZ_RELAY_SERVER_URL__: JSON.stringify(""),
      __BZ_RELAY_PUBLIC_HOST__: JSON.stringify(""),
      __BZ_RELAY_TOKEN__: JSON.stringify(""),
      __BZ_CONFIG_ENCRYPTION_SEED__: JSON.stringify(
        fixtureMode
          ? "bzgames-migration-v1-fixture"
          : privateConfig.configEncryptionSeed || "",
      ),
      __BZ_DATABASE_ENCRYPTION_SEED__: JSON.stringify(
        fixtureMode
          ? "bzgames-migration-v1-fixture"
          : privateConfig.databaseEncryptionSeed || "",
      ),
      __BZ_GAME_MANIFEST_ENCRYPTION_SEED__: JSON.stringify(
        fixtureMode
          ? "bzgames-migration-v1-fixture"
          : privateConfig.gameManifestEncryptionSeed || "",
      ),
      __BZ_OAUTH_RETURN_URL__: JSON.stringify(""),
    },
    plugins: [{
      name: "electron-stub",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export const app={isPackaged:false,getPath:()=>process.cwd(),getVersion:()=>\"4.0.0\"};",
          loader: "js",
        }));
      },
    }],
  });
  const result = spawnSync(electronExecutable, [bundle, archivePath, outputRoot], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(bundle, { force: true });
}
