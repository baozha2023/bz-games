import { app } from "electron";
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { storeService } from "../storage/StoreService";

const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const execFileAsync = promisify(execFile);

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function clearHealthyImportRollbacks(dataRoot: string): Promise<void> {
  const rollbackParent = path.join(dataRoot, ".backup-rollback");
  const entries = await fs
    .readdir(rollbackParent, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rollbackRoot = path.join(rollbackParent, entry.name);
    if (
      await fs
        .stat(path.join(rollbackRoot, "pending-health.json"))
        .catch(() => null)
    ) {
      await fs.rm(rollbackRoot, { recursive: true, force: true });
    }
  }
}

async function applyRollbackUpdateSuppression(
  stateRoot: string,
): Promise<void> {
  const markerPath = path.join(stateRoot, "rollback-suppression.json");
  const content = await fs.readFile(markerPath, "utf8").catch(() => "");
  if (!content) return;
  let marker: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      marker = parsed as Record<string, unknown>;
    }
  } catch (error) {
    logger.warn(
      "[HealthService] Discarding malformed rollback suppression",
      error,
    );
  }
  if (
    !marker ||
    Object.keys(marker).sort().join(",") !== "format,version" ||
    marker.format !== "bz-games-rollback-suppression" ||
    marker.version !== app.getVersion()
  ) {
    logger.warn(
      "[HealthService] Discarding invalid rollback suppression marker",
    );
    await fs.rm(markerPath, { force: true });
    return;
  }
  storeService.saveSettings({
    updatePromptSuppressedForAppVersion: app.getVersion(),
  });
  await fs.rm(markerPath, { force: true });
}

async function sha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function uninstallerVersion(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync(filePath, ["--version"], {
    windowsHide: true,
    timeout: 5_000,
  });
  return stdout.trim();
}

async function refreshRootUninstaller(dataRoot: string): Promise<void> {
  if (!app.isPackaged || process.platform !== "win32") return;
  const source = path.join(
    process.resourcesPath,
    "bootstrap",
    "BZ-Games-Uninstall.exe",
  );
  const target = path.join(dataRoot, "BZ-Games-Uninstall.exe");
  const sourceHash = await sha256(source);
  const targetHash = await sha256(target).catch(() => "");
  const sourceVersion = await uninstallerVersion(source);
  const targetVersion = await uninstallerVersion(target).catch(() => "");
  if (sourceHash === targetHash && sourceVersion === targetVersion) return;
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.copyFile(source, temporary);
  if ((await sha256(temporary)) !== sourceHash) {
    await fs.rm(temporary, { force: true });
    throw new Error("uninstaller_refresh_verification_failed");
  }
  const backup = `${target}.old-${process.pid}-${Date.now()}`;
  let targetMoved = false;
  try {
    await fs.rename(target, backup);
    targetMoved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (targetMoved) await fs.rename(backup, target).catch(() => undefined);
    await fs.rm(temporary, { force: true });
    throw error;
  }
  if (targetMoved) await fs.rm(backup, { force: true });
  logger.info("[HealthService] Refreshed root uninstaller");
}

export async function markApplicationHealthy(): Promise<void> {
  const dataRoot = getAppRoot();
  const stateRoot = path.join(dataRoot, ".runtime", "state");
  const token = process.env.BZ_GAMES_LAUNCH_TOKEN?.trim() || "";
  const health = {
    format: "bz-games-health",
    version: app.getVersion(),
    processId: process.pid,
    healthyAt: new Date().toISOString(),
  };
  await applyRollbackUpdateSuppression(stateRoot);
  if (TOKEN_PATTERN.test(token)) {
    await writeJsonAtomic(
      path.join(stateRoot, `healthy-${token}.json`),
      health,
    );
  }
  await writeJsonAtomic(path.join(stateRoot, "last-good.json"), health);
  await clearHealthyImportRollbacks(dataRoot);
  await refreshRootUninstaller(dataRoot).catch((error) =>
    logger.error("[HealthService] Failed to refresh root uninstaller", error),
  );
  logger.info(`[HealthService] Application ${app.getVersion()} marked healthy`);
}
