import { app } from "electron";
import fs from "fs";
import path from "path";

let customGamesDir: string | null = null;

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

export function isPortableMode(): boolean {
  if (!app.isPackaged) return true;
  const exeDir = getExecutableDir();
  return fs.existsSync(path.join(exeDir, "portable.flag"));
}

export function getAppRoot(): string {
  if (app.isPackaged) {
    if (isPortableMode()) {
      return getExecutableDir();
    }
    return app.getPath("userData");
  }
  return process.cwd();
}

export function setCustomGamesDir(dir: string | null): void {
  customGamesDir = dir?.trim() || null;
}

export function getGamesDir(): string {
  if (customGamesDir) {
    return customGamesDir;
  }
  return path.join(getAppRoot(), "games");
}
