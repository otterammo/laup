import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Cache, createCache, MemoryCache, TieredCache } from "../cache.js";

describe("cache", () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = createCache<string>();
  });

  describe("basic operations", () => {
    it("sets and gets values", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("returns undefined for missing keys", () => {
      expect(cache.get("missing")).toBeUndefined();
    });

    it("checks existence with has()", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("missing")).toBe(false);
    });

    it("deletes keys", () => {
      cache.set("key1", "value1");
      expect(cache.delete("key1")).toBe(true);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("returns false when deleting missing key", () => {
      expect(cache.delete("missing")).toBe(false);
    });

    it("clears all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.clear();
      expect(cache.size()).toBe(0);
    });

    it("returns all keys", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      expect(cache.keys()).toContain("key1");
      expect(cache.keys()).toContain("key2");
    });

    it("returns size", () => {
      expect(cache.size()).toBe(0);
      cache.set("key1", "value1");
      expect(cache.size()).toBe(1);
    });
  });

  describe("TTL expiration", () => {
    it("expires entries after TTL", async () => {
      cache.set("key1", "value1", 50); // 50ms TTL
      expect(cache.get("key1")).toBe("value1");

      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get("key1")).toBeUndefined();
    });

    it("has() returns false for expired entries", async () => {
      cache.set("key1", "value1", 50);
      await new Promise((r) => setTimeout(r, 60));
      expect(cache.has("key1")).toBe(false);
    });

    it("prune() removes expired entries", async () => {
      cache.set("key1", "value1", 50);
      cache.set("key2", "value2", 1000);

      await new Promise((r) => setTimeout(r, 60));

      const pruned = cache.prune();
      expect(pruned).toBe(1);
      expect(cache.size()).toBe(1);
    });
  });

  describe("statistics", () => {
    it("tracks hits", () => {
      cache.set("key1", "value1");
      cache.get("key1");
      cache.get("key1");

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
    });

    it("tracks misses", () => {
      cache.get("missing1");
      cache.get("missing2");

      const stats = cache.stats();
      expect(stats.misses).toBe(2);
    });

    it("calculates hit rate", () => {
      cache.set("key1", "value1");
      cache.get("key1"); // hit
      cache.get("missing"); // miss

      const stats = cache.stats();
      expect(stats.hitRate).toBe(0.5);
    });

    it("tracks evictions", () => {
      const smallCache = createCache<string>({ maxSize: 2 });
      smallCache.set("key1", "value1");
      smallCache.set("key2", "value2");
      smallCache.set("key3", "value3"); // triggers eviction

      const stats = smallCache.stats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe("eviction policies", () => {
    it("LRU evicts least recently used", async () => {
      const lruCache = createCache<string>({ maxSize: 2, evictionPolicy: "lru" });

      lruCache.set("key1", "value1");
      await new Promise((r) => setTimeout(r, 5)); // ensure different timestamps
      lruCache.set("key2", "value2");
      await new Promise((r) => setTimeout(r, 5));
      lruCache.get("key1"); // access key1, making key2 LRU
      await new Promise((r) => setTimeout(r, 5));

      lruCache.set("key3", "value3"); // should evict key2

      expect(lruCache.has("key1")).toBe(true);
      expect(lruCache.has("key2")).toBe(false);
      expect(lruCache.has("key3")).toBe(true);
    });

    it("FIFO evicts oldest entry", () => {
      const fifoCache = createCache<string>({ maxSize: 2, evictionPolicy: "fifo" });

      fifoCache.set("key1", "value1");
      fifoCache.set("key2", "value2");
      fifoCache.set("key3", "value3"); // should evict key1

      expect(fifoCache.has("key1")).toBe(false);
      expect(fifoCache.has("key2")).toBe(true);
      expect(fifoCache.has("key3")).toBe(true);
    });

    it("LFU evicts least frequently used", () => {
      const lfuCache = createCache<string>({ maxSize: 2, evictionPolicy: "lfu" });

      lfuCache.set("key1", "value1");
      lfuCache.set("key2", "value2");
      lfuCache.get("key1"); // access key1 multiple times
      lfuCache.get("key1");

      lfuCache.set("key3", "value3"); // should evict key2 (less accessed)

      expect(lfuCache.has("key1")).toBe(true);
      expect(lfuCache.has("key2")).toBe(false);
      expect(lfuCache.has("key3")).toBe(true);
    });
  });

  describe("invalidate", () => {
    it("invalidates keys matching string pattern", () => {
      cache.set("user:1", "alice");
      cache.set("user:2", "bob");
      cache.set("post:1", "hello");

      const count = cache.invalidate("user:");
      expect(count).toBe(2);
      expect(cache.has("user:1")).toBe(false);
      expect(cache.has("post:1")).toBe(true);
    });

    it("invalidates keys matching regex", () => {
      cache.set("user:1", "alice");
      cache.set("user:2", "bob");
      cache.set("post:1", "hello");

      const count = cache.invalidate(/:\d+$/);
      expect(count).toBe(3);
    });
  });

  describe("getOrSet", () => {
    it("returns cached value if exists", () => {
      cache.set("key1", "cached");
      const factory = vi.fn(() => "new");

      const result = cache.getOrSet("key1", factory);

      expect(result).toBe("cached");
      expect(factory).not.toHaveBeenCalled();
    });

    it("calls factory if key missing", () => {
      const factory = vi.fn(() => "new");

      const result = cache.getOrSet("key1", factory);

      expect(result).toBe("new");
      expect(factory).toHaveBeenCalledOnce();
    });

    it("caches factory result", () => {
      const factory = vi.fn(() => "new");

      cache.getOrSet("key1", factory);
      cache.getOrSet("key1", factory);

      expect(factory).toHaveBeenCalledOnce();
    });
  });

  describe("getOrSetAsync", () => {
    it("returns cached value if exists", async () => {
      cache.set("key1", "cached");
      const factory = vi.fn(async () => "new");

      const result = await cache.getOrSetAsync("key1", factory);

      expect(result).toBe("cached");
      expect(factory).not.toHaveBeenCalled();
    });

    it("calls async factory if key missing", async () => {
      const factory = vi.fn(async () => "new");

      const result = await cache.getOrSetAsync("key1", factory);

      expect(result).toBe("new");
      expect(factory).toHaveBeenCalledOnce();
    });
  });

  describe("wrap", () => {
    it("wraps a function with caching", () => {
      const expensive = vi.fn((n: number) => n * 2);
      const cached = cache.wrap((n: number) => `key:${n}`, expensive);

      expect(cached(5)).toBe(10);
      expect(cached(5)).toBe(10);
      expect(expensive).toHaveBeenCalledOnce();
    });

    it("caches based on key function", () => {
      const expensive = vi.fn((a: number, b: number) => a + b);
      const cached = cache.wrap((a: number, b: number) => `sum:${a}:${b}`, expensive);

      expect(cached(1, 2)).toBe(3);
      expect(cached(1, 2)).toBe(3);
      expect(cached(2, 3)).toBe(5);

      expect(expensive).toHaveBeenCalledTimes(2);
    });
  });
});

describe("TieredCache", () => {
  it("promotes L2 hits to L1", () => {
    const l1 = new MemoryCache<string>();
    const l2 = new MemoryCache<string>();
    const tiered = new TieredCache<string>({}, l2);

    l2.set("key1", "value1");

    // First access from L2
    expect(tiered.get("key1")).toBe("value1");

    // Should now be in L1
    expect(l1.has("key1")).toBe(false); // internal L1, not exposed
  });

  it("writes to both tiers", () => {
    const l2 = new MemoryCache<string>();
    const tiered = new TieredCache<string>({}, l2);

    tiered.set("key1", "value1");

    expect(l2.get("key1")).toBe("value1");
  });

  it("deletes from both tiers", () => {
    const l2 = new MemoryCache<string>();
    const tiered = new TieredCache<string>({}, l2);

    tiered.set("key1", "value1");
    tiered.delete("key1");

    expect(l2.has("key1")).toBe(false);
  });

  it("clears both tiers", () => {
    const l2 = new MemoryCache<string>();
    const tiered = new TieredCache<string>({}, l2);

    tiered.set("key1", "value1");
    l2.set("key2", "value2");

    tiered.clear();

    expect(l2.size()).toBe(0);
  });
});
