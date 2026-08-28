import { z } from "zod";

export const SUPPORTED_LOCALES = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "de-DE",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const SupportedLocaleSchema = z.enum(SUPPORTED_LOCALES);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SupportedLocaleSchema.safeParse(value).success;
}
