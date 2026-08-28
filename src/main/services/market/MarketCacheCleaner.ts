import fsp from "fs/promises";
import { logger } from "../../utils/logger";

export type MarketCachePreparationContext =
  | "download_preflight"
  | "extract_preflight"
  | "resume_restart";

type RemovePath = (targetPath: string) => Promise<void>;

async function removePathAndVerify(targetPath: string): Promise<void> {
  await fsp.rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });

  try {
    await fsp.lstat(targetPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  throw new Error("market_cache_cleanup_incomplete");
}

/**
 * Cache cleanup has two deliberately different contracts:
 * - prepare(): a clean staging path is a precondition, so failure aborts install.
 * - reclaim(): terminal garbage collection is best-effort and never rewrites the
 *   already-decided task result.
 */
export class MarketCacheCleaner {
  constructor(private readonly removePath: RemovePath = removePathAndVerify) {}

  async prepare(
    targetPath: string,
    context: MarketCachePreparationContext,
  ): Promise<void> {
    try {
      await this.removePath(targetPath);
    } catch (error: unknown) {
      logger.error(
        `[MarketCacheCleaner] Required cleanup failed (${context}): ${targetPath}`,
        error,
      );
      throw new Error(`market_cache_cleanup_failed:${context}`, {
        cause: error,
      });
    }
  }

  async reclaim(targetPath: string): Promise<void> {
    try {
      await this.removePath(targetPath);
    } catch (error: unknown) {
      logger.error(
        `[MarketCacheCleaner] Residual cache retained (task_finalization): ${targetPath}`,
        error,
      );
    }
  }
}
