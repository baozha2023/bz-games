import type { SupportedLocale } from "../localization";

export const UNINSTALL_PLAN_FORMAT = "bz-games-uninstall-plan" as const;
export const UNINSTALL_PLAN_VERSION = 1 as const;

export type UninstallSource = "in_app" | "system";

export type UninstallBlocker =
  | "game"
  | "market"
  | "game_import"
  | "storage_migration"
  | "backup"
  | "cloud_sync"
  | "update"
  | "room";

export type UninstallErrorCode =
  | "uninstall_in_progress"
  | "uninstaller_not_found"
  | "uninstall_tasks_active"
  | "unsafe_game_storage_path"
  | "uninstall_handoff_failed"
  | "uninstall_prepare_failed";

export interface UninstallOptions {
  deleteGames: boolean;
  deleteUserData: boolean;
}

export interface UninstallPlanV1 extends UninstallOptions {
  format: typeof UNINSTALL_PLAN_FORMAT;
  formatVersion: typeof UNINSTALL_PLAN_VERSION;
  operationId: string;
  source: "in_app";
  locale: SupportedLocale;
  installRoot: string;
  applicationPid: number;
  gameLibraryRoots: string[];
  createdAt: string;
}

export type UninstallStartResult =
  | { accepted: true; operationId: string }
  | {
      accepted: false;
      error: UninstallErrorCode;
      blockers?: UninstallBlocker[];
    };
