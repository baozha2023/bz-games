import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearForumPostReferenceCache,
  resolveForumPostReferences,
} from "./forum-post-reference-service";

describe("forum post reference resolver", () => {
  beforeEach(clearForumPostReferenceCache);

  it("batches at twenty, caches results and preserves deleted status", async () => {
    const ids = Array.from(
      { length: 21 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const api = {
      resolvePostReferences: vi.fn(async (batch: string[]) => ({
        items: batch.map((id, index) =>
          index === 0
            ? { id, status: "deleted" as const }
            : { id, status: "active" as const, title: id, body: "body" },
        ),
      })),
    };
    const first = await resolveForumPostReferences(ids, api);
    const second = await resolveForumPostReferences(ids, api);
    expect(api.resolvePostReferences).toHaveBeenCalledTimes(2);
    expect(
      api.resolvePostReferences.mock.calls.map(([batch]) => batch.length),
    ).toEqual([20, 1]);
    expect(first.get(ids[0])?.status).toBe("deleted");
    expect(second.get(ids[20])?.status).toBe("deleted");
  });

  it("returns an uncached unavailable state when the network fails", async () => {
    const api = {
      resolvePostReferences: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const result = await resolveForumPostReferences(
      ["00000000-0000-4000-8000-000000000001"],
      api,
    );
    expect(result.values().next().value?.status).toBe("unavailable");
  });
});
