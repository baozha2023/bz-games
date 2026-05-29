import { app } from "electron";
import fs from "fs";
import path from "path";

function timestamp(): string {
  return new Date().toISOString();
}

function formatArgs(args: any[]): string {
  return args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
}

function getErrorLogPath(): string | null {
  try {
    if (app.isPackaged) {
      return path.join(path.dirname(app.getPath("exe")), "bz-games-error.log");
    }
    return null;
  } catch {
    return null;
  }
}

function writeErrorToFile(message: string): void {
  const logPath = getErrorLogPath();
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `[${timestamp()}] ${message}\n`, "utf8");
  } catch {}
}

export const logger = {
  info: (...args: any[]) => console.log("[INFO]", ...args),
  warn: (...args: any[]) => console.warn("[WARN]", ...args),
  error: (...args: any[]) => {
    const msg = formatArgs(args);
    console.error("[ERROR]", msg);
    writeErrorToFile(`[ERROR] ${msg}`);
  },
};
