import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/AppConstants", () => ({
  GITHUB_RAW_BASE: "https://raw.githubusercontent.com/",
  MARKET_GITHUB_INDEX_URL: "https://github.test/market.json",
  MARKET_OSS_INDEX_URL: "https://oss.test/market.json",
}));

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({ logger }));
vi.mock("../../utils/requestInterceptor", () => ({
  requestInterceptor: { buildHeaders: vi.fn(() => ({})) },
}));

import { MarketCatalogClient, MarketCatalogError } from "./MarketCatalogClient";
import {
  isValidGitBranch,
  parseGitHubRepositoryUrl,
} from "../../../shared/types";

function officialPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    marketId: "official",
    marketName: "Official",
    generatedAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    sources: [
      {
        marketId: "official",
        marketName: "Official",
        generatedAt: "2026-08-09T00:00:00.000Z",
        repository: "https://github.com/example/official",
        branch: "main",
      },
    ],
    games: [],
    ...overrides,
  };
}

function externalPayload(overrides: Record<string, unknown> = {}) {
  const { sources: _sources, ...payload } = officialPayload(overrides);
  return payload;
}

function officialSource() {
  return officialPayload().sources.find(
    ({ marketId }) => marketId === "official",
  )!;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void> = vi.fn(async () => {}),
) {
  return new MarketCatalogClient({
    fetchImpl,
    buildHeaders: () => ({}),
    sleep,
    ossUrl: "https://oss.test/market.json",
    githubUrl: "https://github.test/market.json",
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MarketCatalogClient", () => {
  it("accepts only canonical GitHub repositories and valid Git branches", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/example/market.git"),
    ).toEqual({ owner: "example", repository: "market" });
    expect(
      parseGitHubRepositoryUrl("http://github.com/example/market"),
    ).toBeNull();
    expect(
      parseGitHubRepositoryUrl("https://example.com/github.com/example/market"),
    ).toBeNull();
    expect(
      parseGitHubRepositoryUrl("https://github.com/example/market/issues"),
    ).toBeNull();
    expect(isValidGitBranch("feature/market-v2")).toBe(true);
    for (const branch of [
      "../main",
      "/main",
      "main/",
      "main.lock",
      "a@{b",
      "a b",
      "a[b",
    ]) {
      expect(isValidGitBranch(branch)).toBe(false);
    }
  });

  it("uses one OSS response for both the official directory and index", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(officialPayload()));
    const catalog = await createClient(
      fetchImpl as typeof fetch,
    ).fetchOfficialCatalog();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      catalog.directory.sources.some(({ marketId }) => marketId === "official"),
    ).toBe(true);
    expect(catalog.index.marketId).toBe("official");
  });

  it("resolves the official source by marketId instead of array position", async () => {
    const payload = officialPayload();
    payload.sources.unshift({
      marketId: "community",
      marketName: "Community",
      generatedAt: "2026-08-09T00:00:00.000Z",
      repository: "https://github.com/example/community",
      branch: "main",
    });
    const catalog = await createClient(
      vi.fn(async () => jsonResponse(payload)) as typeof fetch,
    ).fetchOfficialCatalog();

    expect(catalog.directory.sources.map(({ marketId }) => marketId)).toEqual([
      "community",
      "official",
    ]);
    expect(catalog.index.marketId).toBe("official");
  });

  it("switches the entire official catalog to GitHub after an OSS failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(officialPayload()));

    const catalog = await createClient(
      fetchImpl as typeof fetch,
    ).fetchOfficialCatalog();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://oss.test/market.json");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://github.test/market.json");
    expect(catalog.index.marketId).toBe("official");
  });

  it.each([408, 429, 500, 503])(
    "retries GitHub once for HTTP %s",
    async (status) => {
      const sleep = vi.fn(async () => {});
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, status))
        .mockResolvedValueOnce(jsonResponse(externalPayload()));
      const client = createClient(fetchImpl as typeof fetch, sleep);

      const index = await client.fetchExternalIndex(officialSource());

      expect(index.marketId).toBe("official");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(1_000);
    },
  );

  it.each([400, 401, 403, 404])(
    "does not retry GitHub for HTTP %s",
    async (status) => {
      const fetchImpl = vi.fn(async () => jsonResponse({}, status));
      const client = createClient(fetchImpl as typeof fetch);

      await expect(
        client.fetchExternalIndex(officialSource()),
      ).rejects.toMatchObject({ kind: "http", status });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry invalid GitHub JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json"));
    const client = createClient(fetchImpl as typeof fetch);

    await expect(
      client.fetchExternalIndex(officialSource()),
    ).rejects.toMatchObject({ kind: "json" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a GitHub network failure once", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(externalPayload()));
    const client = createClient(fetchImpl as typeof fetch);

    await expect(
      client.fetchExternalIndex(officialSource()),
    ).resolves.toMatchObject({ marketId: "official" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry an invalid GitHub schema", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ games: [] }));
    const client = createClient(fetchImpl as typeof fetch);

    await expect(
      client.fetchExternalIndex(officialSource()),
    ).rejects.toMatchObject({ kind: "schema" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a timed-out GitHub request once", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = createClient(fetchImpl as typeof fetch, async () => {});

    const result = client.fetchExternalIndex(officialSource());
    const rejection = expect(result).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(16_000);

    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects an official marketId mismatch and uses the GitHub payload", async () => {
    const mismatched = officialPayload({ marketId: "wrong" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(mismatched))
      .mockResolvedValueOnce(jsonResponse(officialPayload()));

    const catalog = await createClient(
      fetchImpl as typeof fetch,
    ).fetchOfficialCatalog();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(catalog.index.marketId).toBe("official");
  });

  it("rejects the whole Schema 2 market when it contains old field shapes", async () => {
    const validVersion = {
      version: "1.0.0",
      description: "Initial",
      platformVersion: ">=3.0.0",
      downloadUrl: "https://example.com/game.zip",
      size: 10,
    };
    const payload = officialPayload({
      games: [
        {
          id: "com.example.valid",
          name: "Valid",
          author: "Author",
          type: "singleplayer",
          summary: "Summary",
          latestVersion: "2.0.0",
          versions: [{ ...validVersion, version: "bad" }, validVersion],
        },
        { id: "legacy-id", title: "Legacy" },
      ],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(payload));

    await expect(
      createClient(fetchImpl as typeof fetch).fetchOfficialCatalog(),
    ).rejects.toMatchObject({ kind: "schema" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a structured business error for unsupported repositories", async () => {
    const client = createClient(vi.fn() as unknown as typeof fetch);

    await expect(
      client.fetchExternalIndex({
        ...officialSource(),
        repository: "https://gitlab.com/example/market",
      }),
    ).rejects.toBeInstanceOf(MarketCatalogError);
  });
});
