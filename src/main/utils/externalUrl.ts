import { shell } from "electron";

const MAX_EXTERNAL_URL_LENGTH = 2048;

export function normalizeExternalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_EXTERNAL_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function openExternalHttpUrl(value: unknown): Promise<boolean> {
  const url = normalizeExternalHttpUrl(value);
  if (!url) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}
