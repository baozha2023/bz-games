import { createRequire } from "module";
import { Worker } from "worker_threads";
import path from "path";
import { getAppRoot } from "../../../utils/appPath";
import { logger } from "../../../utils/logger";

const requireFromMain = createRequire(__filename);

type SqliteParam = string | number | bigint | Buffer | null;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface PendingTask<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type RequestType =
  | "run"
  | "get"
  | "all"
  | "exec"
  | "batch"
  | "export"
  | "close";

export interface SqliteBatchStatement {
  sql: string;
  params?: SqliteParam[];
}

interface ExportedTable {
  name: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

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
    private readonly encryptionKey: Buffer,
  ) {}

  init(): void {
    if (this.worker) return;
    const betterSqlite3Path = requireFromMain.resolve(
      "better-sqlite3-multiple-ciphers",
    );
    const workerScript = `
const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const Database = require(workerData.betterSqlite3Path);

fs.mkdirSync(path.dirname(workerData.dbPath), { recursive: true });
const db = new Database(workerData.dbPath, { nativeBinding: workerData.nativeBindingPath });
db.pragma("cipher='chacha20'");
db.key(Buffer.from(workerData.encryptionKeyHex, "hex"));
db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
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
    } else if (message.type === "batch") {
      const execute = db.transaction((statements) => {
        for (const statement of statements) {
          db.prepare(statement.sql).run(...(statement.params || []));
        }
      });
      execute(message.statements);
    } else if (message.type === "export") {
      const quoteIdentifier = (value) => \`"\${String(value).replace(/"/g, '""')}"\`;
      const exportTables = db.transaction((tableNames, omittedColumns) => {
        const existingTables = new Set(
          db.prepare(\`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'\`)
            .all()
            .map((row) => row.name),
        );
        return tableNames
          .filter((tableName) => existingTables.has(tableName))
          .map((tableName) => {
            const omitted = new Set(omittedColumns[tableName] || []);
            const columns = db
              .prepare(\`PRAGMA table_info(\${quoteIdentifier(tableName)})\`)
              .all()
              .map((row) => row.name)
              .filter((column) => !omitted.has(column));
            const rows = db
              .prepare(\`SELECT \${columns.map(quoteIdentifier).join(", ")}
                FROM \${quoteIdentifier(tableName)} ORDER BY rowid\`)
              .all();
            return { name: tableName, columns, rows };
          });
      });
      result = exportTables(message.tableNames, message.omittedColumns);
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
        encryptionKeyHex: this.encryptionKey.toString("hex"),
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

  run(sql: string, params: SqliteParam[] = []): Promise<SqliteRunResult> {
    return this.post<SqliteRunResult>("run", sql, params);
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

  batch(statements: SqliteBatchStatement[]): Promise<void> {
    return this.postWithPayload("batch", { statements }).then(() => undefined);
  }

  async exportSqlDump(
    header: string,
    tableNames: string[],
    omittedColumns: Readonly<Record<string, readonly string[]>> = {},
  ): Promise<string> {
    const exportTables = await this.postWithPayload<ExportedTable[]>("export", {
      tableNames,
      omittedColumns,
    });
    const lines = [
      header,
      `-- generated_at: ${new Date().toISOString()}`,
      `-- tables: ${exportTables.map((table) => table.name).join(",")}`,
      "BEGIN TRANSACTION;",
    ];
    for (const table of exportTables) {
      for (const row of table.rows) {
        lines.push(`INSERT OR IGNORE INTO ${this.quoteIdentifier(table.name)} (${table.columns.map((column) => this.quoteIdentifier(column)).join(", ")}) VALUES (${table.columns.map((column) => this.toSqlLiteral(row[column])).join(", ")});`);
      }
    }
    lines.push("COMMIT;");
    lines.push("");
    return lines.join("\n");
  }

  importSqlDump(sql: string): Promise<void> {
    return this.exec(sql);
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
    return this.postWithPayload(type, { sql, params });
  }

  private postWithPayload<T>(
    type: RequestType,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (this.isClosing && type !== "close") return Promise.reject(new Error(`${this.serviceName}_worker_closing`));
    this.init();
    if (!this.worker) return Promise.reject(new Error(`${this.serviceName}_worker_unavailable`));
    const id = this.nextTaskId++;
    return new Promise((resolve, reject) => {
      this.pendingTasks.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker?.postMessage({ id, type, ...payload });
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

}
