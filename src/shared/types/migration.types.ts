export type BackupOperation = "export" | "import";

export type BackupStatus =
  | "idle"
  | "preparing"
  | "archiving"
  | "verifying"
  | "awaiting_confirmation"
  | "importing"
  | "completed"
  | "canceled"
  | "error";

export type BackupErrorCode =
  | "game_running"
  | "market_task_active"
  | "import_task_active"
  | "backup_task_active"
  | "source_missing"
  | "unsafe_source_entry"
  | "unsafe_destination"
  | "insufficient_space"
  | "archive_failed"
  | "database_snapshot_failed"
  | "unsupported_backup"
  | "backup_validation_failed"
  | "replacement_failed"
  | "unknown";

export interface BackupState {
  operation?: BackupOperation;
  status: BackupStatus;
  progress: number;
  processedBytes: number;
  totalBytes: number;
  processedFiles: number;
  totalFiles: number;
  outputPath?: string;
  errorCode?: BackupErrorCode;
}

export interface BackupResult {
  success: boolean;
  canceled?: boolean;
  restartRequired?: boolean;
  state: BackupState;
}

export interface BackupImportPreview {
  token: string;
  formatVersion: 1 | 2;
  dataModelVersion: 1 | 4;
  sourceAppVersion: string;
  exportedAt: string;
  totalFiles: number;
  totalBytes: number;
  externalLibraryCount: number;
}

export interface BackupImportSelectionResult extends BackupResult {
  preview?: BackupImportPreview;
}

export interface BackupManifestV2 {
  format: "bzgames-backup";
  formatVersion: 2;
  dataModelVersion: 4;
  exportedAt: string;
  sourceAppVersion: string;
  sourcePlatform: "win32";
  sourceArch: "x64";
  entries: ["config.json", "games", "db"];
  totalFiles: number;
  totalBytes: number;
  externalLibraryCount: number;
}
