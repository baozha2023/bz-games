import { describe, expect, it } from "vitest";
import type { MarketTaskStatus } from "../../../shared/types";
import {
  canTransitionMarketTask,
  MARKET_TASK_TRANSITION_MATRIX,
} from "./MarketTaskStateMachine";

const ALL_STATUSES: MarketTaskStatus[] = [
  "idle",
  "downloading",
  "verifying",
  "extracting",
  "installing",
  "completed",
  "error",
  "canceled",
  "paused",
  "interrupted",
];

describe("market task transition matrix", () => {
  it("defines every task status explicitly", () => {
    expect(Object.keys(MARKET_TASK_TRANSITION_MATRIX).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  it("accepts the archive and manifest-only success paths", () => {
    const archivePath: MarketTaskStatus[] = [
      "idle",
      "downloading",
      "verifying",
      "extracting",
      "installing",
      "completed",
    ];
    const manifestOnlyPath: MarketTaskStatus[] = [
      "idle",
      "installing",
      "completed",
    ];

    for (const path of [archivePath, manifestOnlyPath]) {
      for (let index = 1; index < path.length; index++) {
        expect(canTransitionMarketTask(path[index - 1], path[index])).toBe(
          true,
        );
      }
    }
  });

  it("supports in-stage progress while rejecting skips and terminal rewrites", () => {
    expect(canTransitionMarketTask("downloading", "downloading")).toBe(true);
    expect(canTransitionMarketTask("verifying", "verifying")).toBe(true);
    expect(canTransitionMarketTask("idle", "completed")).toBe(false);
    expect(canTransitionMarketTask("paused", "verifying")).toBe(false);
    expect(canTransitionMarketTask("completed", "downloading")).toBe(false);
    expect(canTransitionMarketTask("error", "canceled")).toBe(false);
  });

  it("allows errors and cancellation only from meaningful live states", () => {
    for (const status of [
      "idle",
      "downloading",
      "verifying",
      "extracting",
      "installing",
    ] as const) {
      expect(canTransitionMarketTask(status, "error")).toBe(true);
      expect(canTransitionMarketTask(status, "canceled")).toBe(true);
    }
    expect(canTransitionMarketTask("paused", "canceled")).toBe(true);
    expect(canTransitionMarketTask("interrupted", "canceled")).toBe(true);
  });
});
