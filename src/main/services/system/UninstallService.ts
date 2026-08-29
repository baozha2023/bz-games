import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { app } from "electron";

import type {
  UninstallBlocker,
  UninstallOptions,
  UninstallPlanV1,
  UninstallStartResult,
} from "../../../shared/types";
import {
  UNINSTALL_PLAN_FORMAT,
  UNINSTALL_PLAN_VERSION,
} from "../../../shared/types";
import { backupActivityGuard } from "../backup/BackupActivityGuard";
import { backupImportService } from "../backup/BackupImportService";
import { gameImportTaskService } from "../game/GameImportTaskService";
import { gameManager } from "../game/GameManager";
import { marketService } from "../market/MarketService";
import { roomClient } from "../room/RoomClient";
import { roomServer } from "../room/RoomServer";
import { storeService } from "../storage/StoreService";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { cloudSyncService } from "./CloudSyncService";
import { lifecycleOperationGuard } from "./LifecycleOperationGuard";
import { normalizeUninstallStorageRoots } from "./UninstallPathSafety";
import { updateService } from "./UpdateService";

const HANDOFF_TIMEOUT_MS = 10_000;

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await fs.promises.rename(temporary, filePath);
}

class UninstallService {
  private running = false;

  private getProtectedPaths(): string[] {
    return [
      app.getPath("home"),
      app.getPath("appData"),
      app.getPath("userData"),
      app.getPath("temp"),
    ];
  }

  private collectBlockers(): UninstallBlocker[] {
    const blockers: UninstallBlocker[] = [];
    if (gameManager.hasActiveOrLaunchingGames()) blockers.push("game");
    if (marketService.computeTotalProgress().activeTaskCount > 0)
      blockers.push("market");
    if (gameImportTaskService.hasActiveTasks()) blockers.push("game_import");
    if (storeService.hasActiveStorageMigration())
      blockers.push("storage_migration");
    if (backupActivityGuard.isActive() || backupImportService.isActive())
      blockers.push("backup");
    if (cloudSyncService.hasActiveOperation()) blockers.push("cloud_sync");
    if (updateService.hasActiveOperation()) blockers.push("update");
    if (roomServer.hasActiveOperation() || roomClient.hasActiveOperation())
      blockers.push("room");
    return blockers;
  }

  private getWorkRoot(operationId: string): string {
    const localAppData =
      process.env.LOCALAPPDATA?.trim() || app.getPath("appData");
    return path.join(localAppData, "BZ-Games", "UninstallWork", operationId);
  }

  private async findIncompleteOperation(installRoot: string): Promise<
    | {
        operationId: string;
        workRoot: string;
        journalPath: string;
        workerPath: string;
      }
    | undefined
  > {
    const base = path.dirname(this.getWorkRoot("operation"));
    const entries = await fs.promises
      .readdir(base, { withFileTypes: true })
      .catch(() => []);
    const candidates: Array<{
      operationId: string;
      updatedAt: string;
      workRoot: string;
      journalPath: string;
      workerPath: string;
    }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workRoot = path.join(base, entry.name);
      const journalPath = path.join(workRoot, "journal.json");
      const workerPath = path.join(workRoot, "uninstall-worker.exe");
      try {
        const journal = JSON.parse(
          await fs.promises.readFile(journalPath, "utf8"),
        ) as {
          format?: unknown;
          formatVersion?: unknown;
          phase?: unknown;
          updatedAt?: unknown;
          plan?: { operationId?: unknown; installRoot?: unknown };
        };
        if (
          journal.format === "bz-games-uninstall-journal" &&
          journal.formatVersion === UNINSTALL_PLAN_VERSION &&
          journal.phase !== "finalized" &&
          typeof journal.updatedAt === "string" &&
          typeof journal.plan?.operationId === "string" &&
          typeof journal.plan.installRoot === "string" &&
          path.resolve(journal.plan.installRoot).toLowerCase() ===
            path.resolve(installRoot).toLowerCase() &&
          fs.existsSync(workerPath)
        ) {
          candidates.push({
            operationId: journal.plan.operationId,
            updatedAt: journal.updatedAt,
            workRoot,
            journalPath,
            workerPath,
          });
        }
      } catch {
        // Invalid work directories are ignored; the Rust worker validates any
        // selected recovery journal again before it signals readiness.
      }
    }
    candidates.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    return candidates[0];
  }

  private waitForWorkerReady(
    child: ChildProcess,
    readyPath: string,
    operationId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const started = Date.now();
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        error ? reject(error) : resolve();
      };
      const onError = (error: Error) => finish(error);
      const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
        finish(new Error(`uninstall_worker_exit:${code}:${signal || ""}`));
      const timer = setInterval(async () => {
        if (settled) return;
        if (Date.now() - started >= HANDOFF_TIMEOUT_MS) {
          finish(new Error("uninstall_handoff_timeout"));
          return;
        }
        try {
          const content = await fs.promises.readFile(readyPath, "utf8");
          const ready = JSON.parse(content) as {
            operationId?: unknown;
            ready?: unknown;
          };
          if (ready.operationId === operationId && ready.ready === true)
            finish();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") finish(error);
        }
      }, 100);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  }

  private async stopWorker(child: ChildProcess): Promise<boolean> {
    if (!child.pid) return true;
    if (child.exitCode !== null || child.signalCode !== null) return true;
    try {
      child.kill();
    } catch {
      return child.exitCode !== null || child.signalCode !== null;
    }
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async uninstall(options: UninstallOptions): Promise<UninstallStartResult> {
    if (this.running || !lifecycleOperationGuard.tryBegin("uninstall")) {
      return { accepted: false, error: "uninstall_in_progress" };
    }
    this.running = true;
    let handedOff = false;
    let workRoot = "";
    let createdWorkRoot = false;
    let workerProcess: ChildProcess | undefined;
    let workerStopped = true;

    try {
      const blockers = this.collectBlockers();
      if (blockers.length > 0) {
        return {
          accepted: false,
          error: "uninstall_tasks_active",
          blockers,
        };
      }

      const installRoot = getAppRoot();
      const existing = await this.findIncompleteOperation(installRoot);
      if (existing) {
        workRoot = existing.workRoot;
        const readyPath = path.join(workRoot, "ready.json");
        await Promise.all([
          fs.promises.rm(readyPath, { force: true }),
          fs.promises.rm(path.join(workRoot, "cancel.json"), { force: true }),
        ]);
        const child = spawn(
          existing.workerPath,
          ["--resume", existing.journalPath],
          {
            cwd: existing.workRoot,
            detached: true,
            stdio: "ignore",
          },
        );
        workerProcess = child;
        await this.waitForWorkerReady(child, readyPath, existing.operationId);
        child.unref();
        handedOff = true;
        setImmediate(() => app.quit());
        return { accepted: true, operationId: existing.operationId };
      }
      const uninstallerPath = path.join(installRoot, "BZ-Games-Uninstall.exe");
      if (!app.isPackaged || !fs.existsSync(uninstallerPath)) {
        return { accepted: false, error: "uninstaller_not_found" };
      }

      let gameLibraryRoots: string[] = [];
      if (options.deleteGames) {
        gameLibraryRoots = normalizeUninstallStorageRoots(
          storeService.getGameStorageRoots(),
          installRoot,
          this.getProtectedPaths(),
        );
        if (
          gameLibraryRoots.some(
            (root) =>
              fs.existsSync(root) &&
              (fs.lstatSync(root).isSymbolicLink() ||
                fs.lstatSync(root).isFile()),
          )
        ) {
          return { accepted: false, error: "unsafe_game_storage_path" };
        }
      }

      const operationId = crypto.randomUUID();
      workRoot = this.getWorkRoot(operationId);
      await fs.promises.mkdir(workRoot, { recursive: true });
      createdWorkRoot = true;
      const workerPath = path.join(workRoot, "uninstall-worker.exe");
      const planPath = path.join(workRoot, "plan.json");
      const readyPath = path.join(workRoot, "ready.json");
      await fs.promises.copyFile(
        uninstallerPath,
        workerPath,
        fs.constants.COPYFILE_EXCL,
      );
      const plan: UninstallPlanV1 = {
        format: UNINSTALL_PLAN_FORMAT,
        formatVersion: UNINSTALL_PLAN_VERSION,
        operationId,
        source: "in_app",
        locale: storeService.getSettings().language,
        installRoot,
        applicationPid: process.pid,
        deleteGames: options.deleteGames,
        deleteUserData: options.deleteUserData,
        gameLibraryRoots,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(planPath, plan);

      const child = spawn(workerPath, ["--worker", "--plan", planPath], {
        cwd: workRoot,
        detached: true,
        stdio: "ignore",
      });
      workerProcess = child;
      await this.waitForWorkerReady(child, readyPath, operationId);
      child.unref();
      handedOff = true;
      setImmediate(() => app.quit());
      return { accepted: true, operationId };
    } catch (error) {
      if (workerProcess && workRoot) {
        await fs.promises
          .writeFile(path.join(workRoot, "cancel.json"), "{}\n", "utf8")
          .catch(() => undefined);
        workerStopped = await this.stopWorker(workerProcess);
      }
      logger.error("[UninstallService] Failed to prepare uninstall", error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        error:
          message === "unsafe_game_storage_path"
            ? "unsafe_game_storage_path"
            : /handoff|worker|spawn|timeout/i.test(message)
              ? "uninstall_handoff_failed"
              : "uninstall_prepare_failed",
      };
    } finally {
      if (!handedOff) {
        if (workRoot && createdWorkRoot && workerStopped) {
          await fs.promises
            .rm(workRoot, { recursive: true, force: true })
            .catch(() => undefined);
        }
        this.running = false;
        lifecycleOperationGuard.end("uninstall");
      }
    }
  }
}

export const uninstallService = new UninstallService();
