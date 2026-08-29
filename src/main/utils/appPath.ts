import { app } from "electron";
import path from "path";

/**
 * Get the application root directory.
 * - Development: The project root directory (where package.json is).
 * - Production: The directory containing the executable.
 */
export function getExecutableDir(): string {
  if (app.isPackaged) {
    return path.dirname(app.getPath("exe"));
  }
  return process.cwd();
}

export function getAppRoot(): string {
  const launcherDataRoot = process.env.BZ_GAMES_DATA_ROOT?.trim();
  if (launcherDataRoot) {
    return path.resolve(launcherDataRoot);
  }
  if (app.isPackaged) {
    const executableDir = getExecutableDir();
    const normalized = executableDir.replace(/\\/g, "/").toLowerCase();
    if (normalized.includes("/.runtime/current")) {
      return path.resolve(executableDir, "..", "..");
    }
    return executableDir;
  }
  return process.cwd();
}
