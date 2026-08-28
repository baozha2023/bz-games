import {
  MarketDirectorySchema,
  MarketIndexV2Schema,
  OfficialMarketCatalogV2Schema,
  parseGitHubRepositoryUrl,
  type MarketDirectory,
  type RawMarketIndex,
  type MarketSource,
} from "../../../shared/types";
import {
  GITHUB_RAW_BASE,
  MARKET_GITHUB_INDEX_URL,
  MARKET_OSS_INDEX_URL,
} from "../../../shared/AppConstants";
import { logger } from "../../utils/logger";
import { requestInterceptor } from "../../utils/requestInterceptor";

const OSS_TIMEOUT_MS = 5_000;
const GITHUB_TIMEOUT_MS = 8_000;
const GITHUB_RETRY_DELAY_MS = 1_000;

type MarketCatalogErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "json"
  | "schema"
  | "business";

type MarketSourceName = "oss" | "github";

export class MarketCatalogError extends Error {
  constructor(
    readonly kind: MarketCatalogErrorKind,
    readonly source: MarketSourceName,
    readonly url: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`market_catalog_${kind}`, options);
    this.name = "MarketCatalogError";
  }
}

export interface OfficialMarketCatalog {
  directory: MarketDirectory;
  index: RawMarketIndex;
  fetchedAt: number;
}

interface MarketCatalogClientOptions {
  fetchImpl?: typeof fetch;
  buildHeaders?: typeof requestInterceptor.buildHeaders;
  sleep?: (milliseconds: number) => Promise<void>;
  ossUrl?: string;
  githubUrl?: string;
}

export function getMarketSourceKey(source: MarketSource): string {
  return `${source.marketId}\u0000${source.repository}\u0000${source.branch}`;
}

function gitToRawUrl(repository: string, branch: string): string {
  const parsed = parseGitHubRepositoryUrl(repository);
  if (!parsed) {
    throw new Error(`market_unsupported_repo:${repository}`);
  }
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  return `${GITHUB_RAW_BASE}${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/${encodedBranch}/market.json`;
}

function parseIndex(raw: unknown): RawMarketIndex {
  const index = MarketIndexV2Schema.parse(raw);
  return {
    ...index,
    games: index.games.filter((game) => game.visibility !== "hidden"),
  };
}

function toCatalogError(
  error: unknown,
  kind: MarketCatalogErrorKind,
  source: MarketSourceName,
  url: string,
): MarketCatalogError {
  if (error instanceof MarketCatalogError) return error;
  return new MarketCatalogError(kind, source, url, undefined, {
    cause: error,
  });
}

function isRetryable(error: MarketCatalogError): boolean {
  if (error.kind === "timeout" || error.kind === "network") return true;
  return (
    error.kind === "http" &&
    (error.status === 408 ||
      error.status === 429 ||
      (error.status !== undefined && error.status >= 500))
  );
}

export class MarketCatalogClient {
  private readonly fetchImpl: typeof fetch;
  private readonly buildHeaders: typeof requestInterceptor.buildHeaders;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly ossUrl: string;
  private readonly githubUrl: string;

  constructor(options: MarketCatalogClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.buildHeaders =
      options.buildHeaders ??
      requestInterceptor.buildHeaders.bind(requestInterceptor);
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.ossUrl = options.ossUrl ?? MARKET_OSS_INDEX_URL;
    this.githubUrl = options.githubUrl ?? MARKET_GITHUB_INDEX_URL;
  }

  async fetchOfficialCatalog(): Promise<OfficialMarketCatalog> {
    try {
      return await this.fetchAttempt(
        "oss",
        this.ossUrl,
        OSS_TIMEOUT_MS,
        (raw) => this.parseOfficialCatalog(raw, "oss", this.ossUrl),
      );
    } catch (error) {
      this.logFailure(error, 1, "switching_to_github");
      return await this.fetchFromGitHub(this.githubUrl, (raw) =>
        this.parseOfficialCatalog(raw, "github", this.githubUrl),
      );
    }
  }

  async fetchExternalIndex(source: MarketSource): Promise<RawMarketIndex> {
    let url: string;
    try {
      url = gitToRawUrl(source.repository, source.branch);
    } catch (error) {
      throw new MarketCatalogError(
        "business",
        "github",
        source.repository,
        undefined,
        { cause: error },
      );
    }
    return await this.fetchFromGitHub(url, parseIndex);
  }

  private parseOfficialCatalog(
    raw: unknown,
    source: MarketSourceName,
    url: string,
  ): OfficialMarketCatalog {
    let directory: MarketDirectory;
    let index: RawMarketIndex;
    try {
      const catalog = OfficialMarketCatalogV2Schema.parse(raw);
      directory = MarketDirectorySchema.parse({
        schemaVersion: catalog.schemaVersion,
        sources: catalog.sources,
      });
      const { sources: _sources, ...rawIndex } = catalog;
      index = {
        ...rawIndex,
        games: rawIndex.games.filter((game) => game.visibility !== "hidden"),
      };
    } catch (error) {
      throw toCatalogError(error, "schema", source, url);
    }
    if (
      !directory.sources.some(({ marketId }) => marketId === index.marketId)
    ) {
      throw new MarketCatalogError("business", source, url);
    }
    return { directory, index, fetchedAt: Date.now() };
  }

  private async fetchFromGitHub<T>(
    url: string,
    parse: (raw: unknown) => T,
  ): Promise<T> {
    const execute = async (attempt: 1 | 2): Promise<T> => {
      try {
        return await this.fetchAttempt("github", url, GITHUB_TIMEOUT_MS, parse);
      } catch (error) {
        const catalogError = toCatalogError(error, "network", "github", url);
        const retry = attempt === 1 && isRetryable(catalogError);
        this.logFailure(catalogError, attempt, retry ? "retrying" : "failed");
        if (!retry) throw catalogError;
        await this.sleep(GITHUB_RETRY_DELAY_MS);
        return await execute(2);
      }
    };
    return await execute(1);
  }

  private async fetchAttempt<T>(
    source: MarketSourceName,
    url: string,
    timeoutMs: number,
    parse: (raw: unknown) => T,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: this.buildHeaders(url, {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new MarketCatalogError(
          timedOut ? "timeout" : "network",
          source,
          url,
          undefined,
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new MarketCatalogError("http", source, url, response.status);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        throw new MarketCatalogError(
          timedOut ? "timeout" : "json",
          source,
          url,
          undefined,
          { cause: error },
        );
      }

      try {
        return parse(raw);
      } catch (error) {
        throw toCatalogError(error, "schema", source, url);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private logFailure(
    error: unknown,
    attempt: number,
    action: "switching_to_github" | "retrying" | "failed",
  ): void {
    const catalogError = toCatalogError(
      error,
      "network",
      "github",
      this.githubUrl,
    );
    const details = {
      source: catalogError.source,
      kind: catalogError.kind,
      status: catalogError.status,
      attempt,
      action,
    };
    if (action === "failed") {
      logger.error("[MarketCatalogClient] Request failed", details);
    } else {
      logger.warn("[MarketCatalogClient] Request failed", details);
    }
  }
}

export const marketCatalogClient = new MarketCatalogClient();
