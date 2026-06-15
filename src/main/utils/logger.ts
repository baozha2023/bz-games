import { app } from "electron";
import fs from "fs";
import path from "path";

type LogLevel = "info" | "warn" | "error";

type ConsoleMethod = (...args: any[]) => void;

const nativeConsole: Record<LogLevel, ConsoleMethod> = {
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

class Logger {
  private readonly errorLogFileName = "bz-games-error.log";
  private consoleInstalled = false;

  installGlobalHandlers(): void {
    this.installConsoleProxy();

    process.on("uncaughtException", (error) => {
      this.error("[Process] Uncaught exception", error);
    });

    process.on("unhandledRejection", (reason) => {
      this.error("[Process] Unhandled rejection", reason);
    });

    app.on("render-process-gone", (_, webContents, details) => {
      this.error("[Electron] Render process gone", {
        url: webContents.getURL(),
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });

    app.on("child-process-gone", (_, details) => {
      this.error("[Electron] Child process gone", details);
    });
  }

  info(...args: any[]): void {
    this.write("info", args);
  }

  warn(...args: any[]): void {
    this.write("warn", args);
  }

  error(...args: any[]): void {
    this.write("error", args);
  }

  captureRendererError(args: any[]): void {
    this.error("[Renderer]", ...args);
  }

  private installConsoleProxy(): void {
    if (this.consoleInstalled) return;
    this.consoleInstalled = true;
    console.log = (...args: any[]) => this.info(...args);
    console.warn = (...args: any[]) => this.warn(...args);
    console.error = (...args: any[]) => this.error(...args);
  }

  private write(level: LogLevel, args: any[]): void {
    if (this.shouldWriteToConsole()) {
      nativeConsole[level](this.formatConsolePrefix(level), ...args);
      return;
    }

    if (level === "error") {
      this.writeErrorToFile(this.formatFileLine(level, args));
    }
  }

  private shouldWriteToConsole(): boolean {
    return !app.isPackaged;
  }

  private formatConsolePrefix(level: LogLevel): string {
    return `[${level.toUpperCase()}]`;
  }

  private formatFileLine(level: LogLevel, args: any[]): string {
    return `[${this.timestamp()}] [${level.toUpperCase()}] ${this.formatArgs(args)}\n`;
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  private formatArgs(args: any[]): string {
    return args.map((arg) => this.formatArg(arg)).join(" ");
  }

  private formatArg(arg: any): string {
    if (arg instanceof Error) {
      return arg.stack || arg.message;
    }

    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }

    return String(arg);
  }

  private getErrorLogPath(): string | null {
    try {
      if (!app.isPackaged) return null;
      return path.join(path.dirname(app.getPath("exe")), this.errorLogFileName);
    } catch {
      return null;
    }
  }

  private writeErrorToFile(message: string): void {
    const logPath = this.getErrorLogPath();
    if (!logPath) return;

    try {
      fs.appendFileSync(logPath, message, "utf8");
    } catch {}
  }
}

export { Logger };
export const logger = new Logger();
