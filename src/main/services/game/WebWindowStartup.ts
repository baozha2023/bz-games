export const DEFAULT_WEB_WINDOW_WIDTH = 1280;
export const DEFAULT_WEB_WINDOW_HEIGHT = 720;

export interface WebWindowWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebWindowStartupOptions {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximize: boolean;
}

export function resolveWebWindowStartupOptions(
  windowedFullscreen: boolean | undefined,
  workArea?: WebWindowWorkArea,
): WebWindowStartupOptions {
  const maximize = windowedFullscreen === true;
  if (!maximize || !workArea) {
    return {
      width: DEFAULT_WEB_WINDOW_WIDTH,
      height: DEFAULT_WEB_WINDOW_HEIGHT,
      maximize,
    };
  }

  return {
    width: DEFAULT_WEB_WINDOW_WIDTH,
    height: DEFAULT_WEB_WINDOW_HEIGHT,
    x:
      workArea.x +
      Math.max(0, Math.floor((workArea.width - DEFAULT_WEB_WINDOW_WIDTH) / 2)),
    y:
      workArea.y +
      Math.max(
        0,
        Math.floor((workArea.height - DEFAULT_WEB_WINDOW_HEIGHT) / 2),
      ),
    maximize,
  };
}

export function applyWebWindowStartupState(
  window: Pick<Electron.BrowserWindow, "maximize">,
  options: WebWindowStartupOptions,
): void {
  if (options.maximize) {
    window.maximize();
  }
}
