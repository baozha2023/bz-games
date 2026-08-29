export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "downloading"
  | "verifying"
  | "ready"
  | "applying"
  | "canceled"
  | "unsupported"
  | "error";

export type UpdateErrorCode =
  | "network_error"
  | "feed_missing"
  | "feed_invalid"
  | "download_failed"
  | "verify_failed"
  | "permission_denied"
  | "task_active"
  | "unsupported_dev_mode"
  | "unknown";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseNotesMarkdown?: string;
  progress?: number;
  errorCode?: UpdateErrorCode;
  message?: string;
  automatic?: boolean;
}
