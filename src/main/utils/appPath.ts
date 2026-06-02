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
  if (app.isPackaged) {
    return getExecutableDir();
  }
  return process.cwd();
}
