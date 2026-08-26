export const MIGRATION_NOTICE_VERSION = "3.4.2" as const;

export type MigrationExportStatus =
  | "idle"
  | "preparing"
  | "archiving"
  | "verifying"
  | "completed"
  | "canceled"
  | "error";

export type MigrationExportErrorCode =
  | "game_running"
  | "market_task_active"
  | "import_task_active"
  | "export_in_progress"
  | "source_missing"
  | "unsafe_source_entry"
  | "unsafe_destination"
  | "insufficient_space"
  | "archive_failed"
  | "database_snapshot_failed"
  | "unknown";

export interface MigrationExportState {
  status: MigrationExportStatus;
  progress: number;
  processedBytes: number;
  totalBytes: number;
  processedFiles: number;
  totalFiles: number;
  outputPath?: string;
  errorCode?: MigrationExportErrorCode;
}

export interface MigrationExportResult {
  success: boolean;
  canceled?: boolean;
  state: MigrationExportState;
}

export interface MigrationManifestV1 {
  format: "bzgames-migration";
  formatVersion: 1;
  exportedAt: string;
  sourceAppVersion: string;
  sourcePlatform: "win32";
  sourceArch: string;
  sourceAppRoot: string;
  sourceGamesRoot: string;
  entries: ["config.json", "games", "db"];
  totalFiles: number;
  totalBytes: number;
}
