import { createRequire } from "module";
import { Worker } from "worker_threads";
import crypto from "crypto";
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

type RequestType = "run" | "get" | "all" | "batch" | "close";

export interface SqliteBatchStatement {
  sql: string;
  params?: SqliteParam[];
}

export class AsyncSqliteDatabase {
  private worker: Worker | null = null;
  private isClosing = false;
  private nextTaskId = 1;
  private readonly pendingTasks = new Map<number, PendingTask<unknown>>();
  private readonly idleResolvers = new Set<() => void>();
  private readonly expectedWorkerExits = new WeakSet<Worker>();
  private maintenancePromise: Promise<void> | null = null;
  private resolveMaintenance: (() => void) | null = null;

  constructor(
    private readonly serviceName: string,
    private readonly relativeDbPath: string,
    private readonly schemaSql: string[],
    private readonly encryptionKey: Buffer,
    private readonly applicationId: number,
    private readonly userVersion: number,
  ) {}

  private getSchemaFingerprint(): string {
    return crypto
      .createHash("sha256")
      .update(this.schemaSql.join("\n"), "utf8")
      .digest("hex");
  }

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
const configure = (database) => {
  database.pragma("cipher='chacha20'");
  database.key(Buffer.from(workerData.encryptionKeyHex, "hex"));
  database.pragma("foreign_keys = ON");
};
let db;
let startupPhase = "load";
try {
const schemaShape = (database) => JSON.stringify(
  database.prepare("SELECT type, name, tbl_name, sql " +
    "FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' " +
    "ORDER BY type, name").all(),
);
startupPhase = "reference-open";
const reference = new Database(":memory:", {
  nativeBinding: workerData.nativeBindingPath,
});
reference.pragma("foreign_keys = ON");
startupPhase = "reference-schema";
for (const [index, sql] of workerData.schemaSql.entries()) {
  try {
    reference.exec(sql);
  } catch (error) {
    throw new Error("database_schema_statement_" + index + ":" + error.message);
  }
}
startupPhase = "reference-shape";
const expectedSchemaShape = schemaShape(reference);
reference.close();
const validate = (database) => {
  const metaTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bz_schema_meta'",
  ).get();
  if (!metaTable) {
    throw new Error("database_schema_meta_missing");
  }
  const meta = database.prepare(
    "SELECT schema_fingerprint FROM bz_schema_meta WHERE singleton = 1",
  ).get();
  const applicationId = database.pragma("application_id", { simple: true });
  const userVersion = database.pragma("user_version", { simple: true });
  const integrity = database.pragma("integrity_check");
  if (applicationId !== workerData.applicationId) {
    throw new Error("database_application_id_mismatch");
  }
  if (userVersion !== workerData.userVersion) {
    throw new Error("database_user_version_mismatch");
  }
  if (!meta || meta.schema_fingerprint !== workerData.schemaFingerprint) {
    throw new Error("database_schema_fingerprint_mismatch");
  }
  if (schemaShape(database) !== expectedSchemaShape) {
    throw new Error("database_schema_shape_mismatch");
  }
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error("database_integrity_failed");
  }
};

if (!fs.existsSync(workerData.dbPath)) {
  startupPhase = "temporary-open";
  const temporaryPath = workerData.dbPath + ".creating-" + process.pid + "-" + Date.now();
  const temporary = new Database(temporaryPath, {
    nativeBinding: workerData.nativeBindingPath,
  });
  try {
    configure(temporary);
    startupPhase = "temporary-schema";
    temporary.exec("BEGIN IMMEDIATE");
    try {
      for (const [index, sql] of workerData.schemaSql.entries()) {
        try {
          temporary.exec(sql);
        } catch (error) {
          throw new Error("database_schema_statement_" + index + ":" + error.message);
        }
      }
      temporary.prepare(
        "INSERT INTO bz_schema_meta (singleton, schema_fingerprint) VALUES (1, ?)",
      ).run(workerData.schemaFingerprint);
      temporary.exec("COMMIT");
    } catch (error) {
      temporary.exec("ROLLBACK");
      throw error;
    }
    startupPhase = "temporary-validate";
    validate(temporary);
    temporary.close();
    fs.renameSync(temporaryPath, workerData.dbPath);
  } catch (error) {
    try { temporary.close(); } catch {}
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

startupPhase = "database-open";
db = new Database(workerData.dbPath, { nativeBinding: workerData.nativeBindingPath });
configure(db);
startupPhase = "database-probe";
db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
startupPhase = "database-validate";
validate(db);
startupPhase = "database-wal";
db.pragma("journal_mode = WAL");
} catch (error) {
  parentPort?.postMessage({
    id: 0,
    ok: false,
    error: startupPhase + ":" + (error?.message || error?.code || String(error)),
  });
}

if (db) parentPort?.on("message", (message) => {
  try {
    let result = null;
    if (message.type === "run") {
      result = db.prepare(message.sql).run(...message.params);
    } else if (message.type === "get") {
      result = db.prepare(message.sql).get(...message.params);
    } else if (message.type === "all") {
      result = db.prepare(message.sql).all(...message.params);
    } else if (message.type === "batch") {
      const execute = db.transaction((statements) => {
        for (const statement of statements) {
          db.prepare(statement.sql).run(...(statement.params || []));
        }
      });
      execute(message.statements);
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
        schemaFingerprint: this.getSchemaFingerprint(),
        applicationId: this.applicationId,
        userVersion: this.userVersion,
        encryptionKeyHex: this.encryptionKey.toString("hex"),
        betterSqlite3Path,
        nativeBindingPath: this.resolveNativeBindingPath(betterSqlite3Path),
      },
    });
    worker.on("message", (message) => this.handleWorkerMessage(message));
    worker.on("error", (error) => {
      const raw = error as Error & { code?: string };
      const normalized =
        raw.message && raw.message !== "[object Object]"
          ? raw
          : new Error(raw.code || "database_worker_startup_failed");
      logger.error(`[${this.serviceName}] Worker error`, normalized);
      this.rejectAll(normalized);
      this.worker = null;
    });
    worker.on("exit", (code) => {
      const expectedExit =
        this.expectedWorkerExits.has(worker) ||
        (this.isClosing && this.worker === worker);
      if (code !== 0 && !expectedExit) {
        const error = new Error(`${this.serviceName}_worker_exited_${code}`);
        logger.error(`[${this.serviceName}] Worker exited unexpectedly`, error);
        this.rejectAll(error);
      }
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    logger.info(
      `[${this.serviceName}] Initialized at: ${this.getDatabasePath()}`,
    );
  }

  getDatabasePath(): string {
    return path.isAbsolute(this.relativeDbPath)
      ? this.relativeDbPath
      : path.join(getAppRoot(), this.relativeDbPath);
  }

  private resolveNativeBindingPath(packageEntryPath: string): string {
    return path.join(
      packageEntryPath,
      "..",
      "..",
      "build",
      "Release",
      "better_sqlite3.node",
    );
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

  batch(statements: SqliteBatchStatement[]): Promise<void> {
    return this.postWithPayload("batch", { statements }).then(() => undefined);
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    this.isClosing = true;
    await this.waitForIdle();
    let closeError: unknown;
    await this.post("close").catch((error) => {
      closeError = error;
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
    if (closeError) throw closeError;
  }

  async suspendForSnapshot(): Promise<void> {
    if (this.maintenancePromise) {
      throw new Error(`${this.serviceName}_snapshot_already_active`);
    }
    this.maintenancePromise = new Promise<void>((resolve) => {
      this.resolveMaintenance = resolve;
    });
    try {
      await this.close();
    } catch (error) {
      this.resumeAfterSnapshot();
      throw error;
    }
  }

  resumeAfterSnapshot(): void {
    if (!this.maintenancePromise) return;
    this.init();
    const resolve = this.resolveMaintenance;
    this.maintenancePromise = null;
    this.resolveMaintenance = null;
    resolve?.();
  }

  private post<T>(
    type: RequestType,
    sql = "",
    params: SqliteParam[] = [],
  ): Promise<T> {
    return this.postWithPayload(type, { sql, params });
  }

  private postWithPayload<T>(
    type: RequestType,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (this.maintenancePromise && type !== "close") {
      return this.maintenancePromise.then(() =>
        this.postWithPayload<T>(type, payload),
      );
    }
    if (this.isClosing && type !== "close")
      return Promise.reject(new Error(`${this.serviceName}_worker_closing`));
    this.init();
    if (!this.worker)
      return Promise.reject(
        new Error(`${this.serviceName}_worker_unavailable`),
      );
    const id = this.nextTaskId++;
    return new Promise((resolve, reject) => {
      this.pendingTasks.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker?.postMessage({ id, type, ...payload });
    });
  }

  private handleWorkerMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const payload = message as {
      id?: number;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (typeof payload.id !== "number") return;
    if (payload.id === 0 && payload.ok === false) {
      const error = new Error(
        payload.error || `${this.serviceName}_worker_startup_failed`,
      );
      this.rejectAll(error);
      const worker = this.worker;
      this.worker = null;
      if (worker) this.expectedWorkerExits.add(worker);
      void worker?.terminate();
      return;
    }
    const task = this.pendingTasks.get(payload.id);
    if (!task) return;
    this.pendingTasks.delete(payload.id);
    if (payload.ok) {
      task.resolve(payload.result);
    } else {
      task.reject(
        new Error(payload.error || `${this.serviceName}_sqlite_task_failed`),
      );
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
}
