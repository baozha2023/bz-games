import { afterEach, describe, expect, it } from "vitest";
import type { UpdateState } from "../../../shared/types";
import {
  hideUpdatePrompt,
  showUpdatePrompt,
  useUpdatePrompt,
} from "./useUpdatePrompt";

const availableState: UpdateState = {
  status: "available",
  currentVersion: "3.2.0",
  latestVersion: "3.2.3",
};

describe("useUpdatePrompt", () => {
  afterEach(() => {
    hideUpdatePrompt();
  });

  it("shows one shared prompt for an available update", () => {
    expect(showUpdatePrompt(availableState)).toBe(true);

    const prompt = useUpdatePrompt();
    expect(prompt.visible.value).toBe(true);
    expect(prompt.updateState.value).toEqual(availableState);
  });

  it("deduplicates concurrent prompt requests", () => {
    expect(showUpdatePrompt(availableState)).toBe(true);
    expect(showUpdatePrompt({ ...availableState, latestVersion: "3.2.4" })).toBe(
      false,
    );
    expect(useUpdatePrompt().updateState.value?.latestVersion).toBe("3.2.3");
  });

  it("ignores states that cannot be displayed as update prompts", () => {
    expect(
      showUpdatePrompt({
        status: "up_to_date",
        currentVersion: "3.2.3",
        latestVersion: "3.2.3",
      }),
    ).toBe(false);
    expect(
      showUpdatePrompt({
        status: "available",
        currentVersion: "3.2.0",
      }),
    ).toBe(false);
    expect(useUpdatePrompt().visible.value).toBe(false);
  });
});
