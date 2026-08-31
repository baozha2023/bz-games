import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";
import {
  publishReleaseBundle,
  releaseLimits,
} from "../src/services/release-bundle-service.js";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error("arguments must be --name value pairs");
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`);
    values.set(key, value);
  }
  const allowed = new Set(["--staged-dir", "--channel", "--allow-downgrade"]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`unknown argument: ${key}`);
  }
  const channel = values.get("--channel");
  if (!new Set(["stable", "test"]).has(channel))
    throw new Error("channel must be stable or test");
  const stagedDir = values.get("--staged-dir");
  if (!stagedDir) throw new Error("staged-dir is required");
  const allowRaw = values.get("--allow-downgrade") || "false";
  if (!new Set(["true", "false"]).has(allowRaw))
    throw new Error("allow-downgrade must be true or false");
  return { channel, stagedDir, allowDowngrade: allowRaw === "true" };
}

export async function publishDesktopReleaseBundle(
  options,
  runtimeConfig = config,
) {
  const storageRoot =
    options.channel === "test"
      ? runtimeConfig.TEST_DESKTOP_RELEASE_STORAGE_DIR
      : runtimeConfig.DESKTOP_RELEASE_STORAGE_DIR;
  return await publishReleaseBundle({
    storageRoot,
    stagedDir: options.stagedDir,
    channel: options.channel,
    limits: releaseLimits(runtimeConfig),
    allowDowngrade: options.allowDowngrade,
  });
}

async function main() {
  const result = await publishDesktopReleaseBundle(
    parseArguments(process.argv.slice(2)),
  );
  console.log(
    JSON.stringify({
      ok: true,
      status: result.status,
      release: {
        version: result.release.version,
        closureSha256: result.release.closureSha256,
      },
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[desktop-release-publish] ${error.message}`);
    process.exitCode = 1;
  });
}
