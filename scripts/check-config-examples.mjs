import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assertSameKeys(label, expected, actual) {
  const expectedKeys = sortedUnique(expected);
  const actualKeys = sortedUnique(actual);
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} fields differ; missing=[${missing.join(",")}], extra=[${extra.join(",")}]`,
    );
  }
  console.log(`${label}: ${expectedKeys.length} fields`);
}

function jsonKeys(relativePath) {
  return Object.keys(JSON.parse(read(relativePath)));
}

function privateConfigTypeKeys() {
  const source = read("electron.vite.config.ts");
  const block = source.match(
    /type PrivateBuildConfig = \{([\s\S]*?)\n\};/,
  )?.[1];
  if (!block) throw new Error("PrivateBuildConfig type was not found");
  return [...block.matchAll(/^\s*([A-Za-z0-9_]+)\?:/gm)].map(
    (match) => match[1],
  );
}

function relayConfigKeys() {
  const source = read("relay-server/src/config.js");
  return [
    ...source.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\["([A-Z0-9_]+)"\])/g),
  ]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
}

function systemdEnvironmentKeys(relativePath) {
  return read(relativePath)
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^Environment="?([A-Z0-9_]+)=/)?.[1])
    .filter(Boolean);
}

function assertGitIgnored(relativePaths) {
  const missing = relativePaths.filter((relativePath) => {
    const result = spawnSync(
      "git",
      ["check-ignore", "--quiet", "--no-index", "--", relativePath],
      { cwd: root },
    );
    return result.status !== 0;
  });
  if (missing.length) {
    throw new Error(
      `required private/local files are not ignored: [${missing.join(",")}]`,
    );
  }
  console.log(`gitignore protected paths: ${relativePaths.length}`);
}

const clientExampleKeys = jsonKeys("private-build.config.example.json");
assertSameKeys(
  "client example/type",
  clientExampleKeys,
  privateConfigTypeKeys(),
);

const privateConfigPath = path.join(root, "private-build.config.json");
if (fs.existsSync(privateConfigPath)) {
  assertSameKeys(
    "client example/actual",
    clientExampleKeys,
    Object.keys(JSON.parse(fs.readFileSync(privateConfigPath, "utf8"))),
  );
} else {
  console.log("client actual config: skipped (private file is absent)");
}

assertSameKeys(
  "relay code/systemd example",
  relayConfigKeys(),
  systemdEnvironmentKeys("relay-server/bz-games-relay.service.example"),
);

assertGitIgnored([
  "private-build.config.json",
  "config.json",
  "relay-server/bz-games-relay.service",
  ".env",
  "relay-server/.env.production",
  ".idea/workspace.xml",
  ".vscode/settings.json",
  "local.code-workspace",
  "credentials.json",
  "certificate.key",
]);
