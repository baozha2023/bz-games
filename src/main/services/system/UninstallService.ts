import fs from "fs";
import path from "path";
import { app, shell } from "electron";

import { gameManager } from "../game/GameManager";
import { marketService } from "../market/MarketService";
import { storeService } from "../storage/StoreService";
import { logger } from "../../utils/logger";

export type UninstallResult =
  | { success: true }
  | { success: false; error: string; paths?: string[] };

function isSamePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function normalizeUninstallStorageRoots(
  roots: string[],
  installDir: string,
  protectedPaths: string[],
): string[] {
  const normalizedInstallDir = path.resolve(installDir);
  const normalizedProtected = protectedPaths.map((item) => path.resolve(item));
  const result: string[] = [];

  for (const value of roots) {
    if (typeof value !== "string" || !value.trim()) continue;
    const root = path.resolve(value.trim());
    if (
      isSamePath(root, path.parse(root).root) ||
      containsPath(root, normalizedInstallDir) ||
      normalizedProtected.some((item) => isSamePath(root, item))
    ) {
      throw new Error("unsafe_game_storage_path");
    }
    if (!result.some((item) => isSamePath(item, root))) {
      result.push(root);
    }
  }
  return result;
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

  private async removeStorageRoots(roots: string[]): Promise<string[]> {
    const failures: string[] = [];
    for (const root of roots) {
      try {
        await fs.promises.rm(root, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 250,
        });
        if (fs.existsSync(root)) failures.push(root);
      } catch (error) {
        logger.warn(
          `[UninstallService] Failed to remove storage root: ${root}`,
          error,
        );
        failures.push(root);
      }
    }
    return failures;
  }

  private async launchUninstaller(uninstallerPath: string): Promise<void> {
    const error = await shell.openPath(uninstallerPath);
    if (error) {
      throw new Error(`uninstaller_launch_failed:${error}`);
    }
  }

  async uninstall(deleteGames: boolean): Promise<UninstallResult> {
    if (this.running) {
      return { success: false, error: "uninstall_in_progress" };
    }
    this.running = true;

    try {
      const installDir = path.dirname(app.getPath("exe"));
      const uninstallerPath = path.join(installDir, "Uninstall BZ-Games.exe");
      if (!fs.existsSync(uninstallerPath)) {
        return { success: false, error: "uninstaller_not_found" };
      }

      if (marketService.computeTotalProgress().activeTaskCount > 0) {
        return { success: false, error: "uninstall_market_tasks_active" };
      }

      let roots: string[] = [];
      if (deleteGames) {
        roots = normalizeUninstallStorageRoots(
          storeService.getGameStorageRoots(),
          installDir,
          this.getProtectedPaths(),
        );
        if (
          roots.some(
            (root) => fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink(),
          )
        ) {
          return { success: false, error: "unsafe_game_storage_path" };
        }
      }

      await gameManager.shutdownForUninstall();

      if (deleteGames) {
        const failures = await this.removeStorageRoots(roots);
        if (failures.length > 0) {
          return {
            success: false,
            error: "uninstall_game_library_delete_failed",
            paths: failures,
          };
        }
      }

      await this.launchUninstaller(uninstallerPath);
      setTimeout(() => app.quit(), 500);
      return { success: true };
    } catch (error) {
      logger.error("[UninstallService] Failed to prepare uninstall", error);
      return {
        success: false,
        error:
          error instanceof Error && error.message === "unsafe_game_storage_path"
            ? error.message
            : "uninstall_prepare_failed",
      };
    } finally {
      this.running = false;
    }
  }
}

export const uninstallService = new UninstallService();
