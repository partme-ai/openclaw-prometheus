import { describe, expect, it, vi } from "vitest";
import { CollectCache } from "./collect-cache.js";

describe("CollectCache", () => {
  it("deduplicates concurrent collection requests", async () => {
    const cache = new CollectCache(1000);
    const factory = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        definitions: [],
        samples: [],
        diagnostics: [],
      };
    });

    await Promise.all([
      cache.getOrCollect(factory),
      cache.getOrCollect(factory),
      cache.getOrCollect(factory),
    ]);

    expect(factory).toHaveBeenCalledTimes(1);
  });
});
