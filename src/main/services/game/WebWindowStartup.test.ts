import { describe, expect, it, vi } from "vitest";
import {
  applyWebWindowStartupState,
  resolveWebWindowStartupOptions,
} from "./WebWindowStartup";

describe("Web window startup", () => {
  const workArea = { x: 100, y: 50, width: 1920, height: 1080 };

  it("keeps the default 1280x720 window when fullscreen is disabled", () => {
    expect(resolveWebWindowStartupOptions(false, workArea)).toEqual({
      width: 1280,
      height: 720,
      maximize: false,
    });
    expect(resolveWebWindowStartupOptions(undefined)).toEqual({
      width: 1280,
      height: 720,
      maximize: false,
    });
  });

  it("centers the normal restore bounds before maximizing", () => {
    expect(resolveWebWindowStartupOptions(true, workArea)).toEqual({
      width: 1280,
      height: 720,
      x: 420,
      y: 230,
      maximize: true,
    });
  });

  it("maximizes only when requested", () => {
    const win = { maximize: vi.fn() };
    const options = resolveWebWindowStartupOptions(true);

    applyWebWindowStartupState(win, options);
    expect(win.maximize).toHaveBeenCalledOnce();

    const normalWindow = { maximize: vi.fn() };
    applyWebWindowStartupState(
      normalWindow,
      resolveWebWindowStartupOptions(false),
    );
    expect(normalWindow.maximize).not.toHaveBeenCalled();
  });
});
