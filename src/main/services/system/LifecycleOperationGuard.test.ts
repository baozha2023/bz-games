import { describe, expect, it } from "vitest";

import { LifecycleOperationGuard } from "./LifecycleOperationGuard";

describe("LifecycleOperationGuard", () => {
  it("allows only one lifecycle mutation at a time", () => {
    const guard = new LifecycleOperationGuard();

    expect(guard.tryBegin("uninstall")).toBe(true);
    expect(guard.tryBegin("update")).toBe(false);
    expect(guard.blocksNewActivity()).toBe(true);
  });

  it("can only be released by the owning operation", () => {
    const guard = new LifecycleOperationGuard();
    expect(guard.tryBegin("update")).toBe(true);

    guard.end("uninstall");
    expect(guard.isActive("update")).toBe(true);

    guard.end("update");
    expect(guard.blocksNewActivity()).toBe(false);
    expect(guard.tryBegin("uninstall")).toBe(true);
  });
});
