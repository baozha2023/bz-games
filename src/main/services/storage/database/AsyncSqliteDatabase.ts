import { createRequire } from "module";
import { Worker } from "worker_threads";
import path from "path";
import { getAppRoot } from "../../../utils/appPath";
import { logger } from "../../../utils/logger";

const requireFromMain = createRequire(__filename);

type SqliteParam = string | number | bigint | Buffer | null;

interface PendingTask<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type RequestType = "run" | "get" | "all" | "exec" | "close";

export class AsyncSqliteDatabase {
  private worker: Worker | null = null;
  private isClosing = false;
  private nextTaskId = 1;
  private readonly pendingTasks = new Map<number, PendingTask<unknown>>();
  private readonly idleResolvers = new Set<() => void>();
  private readonly expectedWorkerExits = new WeakSet<Worker>();

  constructor(
    private readonly serviceName: string,
    private readonly relativeDbPath: string,
    private readonly schemaSql: string[],
  ) {}

  init(): void {
    if (this.worker) return;
    const betterSqlite3Path = requireFromMain.resolve("better-sqlite3");
    const workerScript = `
const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const Database = require(workerData.betterSqlite3Path);

fs.mkdirSync(path.dirname(workerData.dbPath), { recursive: true });
const db = new Database(workerData.dbPath, { nativeBinding: workerData.nativeBindingPath });
db.pragma("journal_mode = WAL");
for (const sql of workerData.schemaSql) db.exec(sql);

parentPort?.on("message", (message) => {
  try {
    let result = null;
    if (message.type === "run") {
      result = db.prepare(message.sql).run(...message.params);
    } else if (message.type === "get") {
      result = db.prepare(message.sql).get(...message.params);
    } else if (message.type === "all") {
      result = db.prepare(message.sql).all(...message.params);
    } else if (message.type === "exec") {
      db.exec(message.sql);
    } else if (message.type === "close") {
      db.close();
    } else {
      throw new Error("unknown_sqlite_worker_message_type");
    }
    parentPort?.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, ok: false, error: error.message });
  }
});
`;
    const worker = new Worker(workerScript, {
      eval: true,
      workerData: {
        dbPath: this.getDatabasePath(),
        schemaSql: this.schemaSql,
        betterSqlite3Path,
        nativeBindingPath: this.resolveNativeBindingPath(betterSqlite3Path),
      },
    });
    worker.on("message", (message) => this.handleWorkerMessage(message));
    worker.on("error", (error) => {
      logger.error(`[${this.serviceName}] Worker error`, error);
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.worker = null;
    });
    worker.on("exit", (code) => {
      const expectedExit = this.expectedWorkerExits.has(worker) || (this.isClosing && this.worker === worker);
      if (code !== 0 && !expectedExit) {
        const error = new Error(`${this.serviceName}_worker_exited_${code}`);
        logger.error(`[${this.serviceName}] Worker exited unexpectedly`, error);
        this.rejectAll(error);
      }
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    logger.info(`[${this.serviceName}] Initialized at: ${this.getDatabasePath()}`);
  }

  getDatabasePath(): string {
    return path.join(getAppRoot(), this.relativeDbPath);
  }

  private resolveNativeBindingPath(packageEntryPath: string): string {
    return path.join(packageEntryPath, "..", "..", "build", "Release", "better_sqlite3.node");
  }

  run(sql: string, params: SqliteParam[] = []): Promise<void> {
    return this.post("run", sql, params).then(() => undefined);
  }

  get<T>(sql: string, params: SqliteParam[] = []): Promise<T | undefined> {
    return this.post<T | undefined>("get", sql, params);
  }

  all<T>(sql: string, params: SqliteParam[] = []): Promise<T[]> {
    return this.post<T[]>("all", sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.post("exec", sql).then(() => undefined);
  }

  async exportSqlDump(header: string, tableNames: string[]): Promise<string> {
    const existingTables = new Set((await this.all<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`,
    )).map((row) => row.name));
    const exportTables = tableNames.filter((tableName) => existingTables.has(tableName));
    const lines = [
      header,
      `-- generated_at: ${new Date().toISOString()}`,
      `-- tables: ${exportTables.join(",")}`,
      "BEGIN TRANSACTION;",
    ];
    for (const tableName of exportTables) {
      const columns = await this.getTableColumns(tableName);
      lines.push(`DELETE FROM ${this.quoteIdentifier(tableName)};`);
      const rows = await this.all<Record<string, unknown>>(`SELECT ${columns.map((column) => this.quoteIdentifier(column)).join(", ")} FROM ${this.quoteIdentifier(tableName)}`);
      for (const row of rows) {
        lines.push(`INSERT INTO ${this.quoteIdentifier(tableName)} (${columns.map((column) => this.quoteIdentifier(column)).join(", ")}) VALUES (${columns.map((column) => this.toSqlLiteral(row[column])).join(", ")});`);
      }
    }
    lines.push("COMMIT;");
    lines.push("");
    return lines.join("\n");
  }

  async importSqlDump(header: string, tableNames: string[], sql: string): Promise<void> {
    const normalizedSql = String(sql || "").trim();
    if (!normalizedSql.startsWith(header)) {
      throw new Error("invalid_cloud_sql_dump");
    }
    await this.validateSqlDump(normalizedSql, new Set(tableNames));
    await this.exec(normalizedSql);
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    this.isClosing = true;
    await this.waitForIdle();
    await this.post("close").catch((error) => {
      logger.error(`[${this.serviceName}] Failed to close database`, error);
    });
    const worker = this.worker;
    this.worker = null;
    if (worker) this.expectedWorkerExits.add(worker);
    try {
      await worker?.terminate();
    } finally {
      this.isClosing = false;
    }
    logger.info(`[${this.serviceName}] Closed`);
  }

  private post<T>(type: RequestType, sql = "", params: SqliteParam[] = []): Promise<T> {
    if (this.isClosing && type !== "close") return Promise.reject(new Error(`${this.serviceName}_worker_closing`));
    this.init();
    if (!this.worker) return Promise.reject(new Error(`${this.serviceName}_worker_unavailable`));
    const id = this.nextTaskId++;
    return new Promise((resolve, reject) => {
      this.pendingTasks.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker?.postMessage({ id, type, sql, params });
    });
  }

  private handleWorkerMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const payload = message as { id?: number; ok?: boolean; result?: unknown; error?: string };
    if (typeof payload.id !== "number") return;
    const task = this.pendingTasks.get(payload.id);
    if (!task) return;
    this.pendingTasks.delete(payload.id);
    if (payload.ok) {
      task.resolve(payload.result);
    } else {
      task.reject(new Error(payload.error || `${this.serviceName}_sqlite_task_failed`));
    }
    this.resolveIdleIfNeeded();
  }

  private rejectAll(error: Error): void {
    for (const task of this.pendingTasks.values()) {
      task.reject(error);
    }
    this.pendingTasks.clear();
    this.resolveIdleIfNeeded();
  }

  private waitForIdle(): Promise<void> {
    if (this.pendingTasks.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.add(resolve));
  }

  private resolveIdleIfNeeded(): void {
    if (this.pendingTasks.size > 0) return;
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }

  private async getTableColumns(tableName: string): Promise<string[]> {
    const rows = await this.all<{ name: string }>(`PRAGMA table_info(${this.quoteIdentifier(tableName)})`);
    return rows.map((row) => row.name);
  }

  private quoteIdentifier(value: string): string {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  private toSqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
    if (typeof value === "bigint") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private async validateSqlDump(sql: string, allowedTables: Set<string>): Promise<void> {
    const existingTables = new Set((await this.all<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`,
    )).map((row) => row.name));
    const currentTables = new Set([...allowedTables].filter((tableName) => existingTables.has(tableName)));
    const deletedTables = new Set<string>();
    const stripped = sql
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/X'(?:[0-9a-fA-F]{2})*'/g, "X''")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = stripped.split(";").map((statement) => statement.trim()).filter(Boolean);
    if (!statements.some((statement) => /^COMMIT$/i.test(statement))) throw new Error("invalid_cloud_sql_transaction");
    for (const statement of statements) {
      if (/^BEGIN\s+TRANSACTION$/i.test(statement) || /^COMMIT$/i.test(statement)) continue;
      const deleteMatch = statement.match(/^DELETE\s+FROM\s+"((?:""|[^"])*)"$/i);
      if (deleteMatch) {
        const tableName = deleteMatch[1].replace(/""/g, '"');
        if (!currentTables.has(tableName)) throw new Error("invalid_cloud_sql_table");
        deletedTables.add(tableName);
        continue;
      }
      const insertMatch = statement.match(/^INSERT\s+INTO\s+"((?:""|[^"])*)"\s*\(/i);
      if (insertMatch) {
        const tableName = insertMatch[1].replace(/""/g, '"');
        if (!currentTables.has(tableName)) throw new Error("invalid_cloud_sql_table");
        if (!deletedTables.has(tableName)) throw new Error("invalid_cloud_sql_order");
        continue;
      }
      throw new Error("invalid_cloud_sql_statement");
    }
  }
}
