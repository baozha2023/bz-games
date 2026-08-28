import type { MarketTaskStatus } from "../../../shared/types";

type TransitionMatrix = Readonly<
  Record<MarketTaskStatus, ReadonlySet<MarketTaskStatus>>
>;

/**
 * Resume creates a new task instance from a persisted snapshot, so paused and
 * interrupted tasks only transition to canceled within their existing instance.
 */
export const MARKET_TASK_TRANSITION_MATRIX: TransitionMatrix = {
  idle: new Set(["downloading", "installing", "error", "canceled"]),
  downloading: new Set([
    "downloading",
    "verifying",
    "paused",
    "error",
    "canceled",
  ]),
  verifying: new Set([
    "verifying",
    "extracting",
    "paused",
    "error",
    "canceled",
  ]),
  extracting: new Set(["extracting", "installing", "error", "canceled"]),
  installing: new Set(["installing", "completed", "error", "canceled"]),
  paused: new Set(["canceled"]),
  interrupted: new Set(["canceled"]),
  completed: new Set(),
  error: new Set(),
  canceled: new Set(),
};

export function canTransitionMarketTask(
  current: MarketTaskStatus,
  next: MarketTaskStatus,
): boolean {
  return MARKET_TASK_TRANSITION_MATRIX[current].has(next);
}
