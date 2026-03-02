/**
 * Cache layer (INFRA-009).
 * In-memory caching with TTL and statistics.
 */

/**
 * Cache entry with metadata.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
  hitRate: number;
}

/**
 * Cache options.
 */
export interface CacheOptions {
  /** Default TTL in milliseconds */
  defaultTtlMs?: number;

  /** Maximum number of entries */
  maxSize?: number;

  /** Eviction policy */
  evictionPolicy?: "lru" | "lfu" | "fifo";

  /** Enable statistics tracking */
  trackStats?: boolean;
}

/**
 * Cache interface.
 */
export interface Cache<T = unknown> {
  /** Get a value by key */
  get(key: string): T | undefined;

  /** Set a value with optional TTL */
  set(key: string, value: T, ttlMs?: number): void;

  /** Check if key exists and is not expired */
  has(key: string): boolean;

  /** Delete a key */
  delete(key: string): boolean;

  /** Clear all entries */
  clear(): void;

  /** Get cache statistics */
  stats(): CacheStats;

  /** Get all keys */
  keys(): string[];

  /** Get number of entries */
  size(): number;

  /** Invalidate entries matching a pattern */
  invalidate(pattern: string | RegExp): number;

  /** Get or set with factory function */
  getOrSet(key: string, factory: () => T, ttlMs?: number): T;

  /** Get or set with async factory */
  getOrSetAsync(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T>;

  /** Wrap a function with caching */
  wrap<Args extends unknown[], R>(
    keyFn: (...args: Args) => string,
    fn: (...args: Args) => R,
    ttlMs?: number,
  ): (...args: Args) => R;

  /** Prune expired entries */
  prune(): number;
}

/**
 * In-memory cache implementation.
 */
export class MemoryCache<T = unknown> implements Cache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map();
  private insertOrder: string[] = [];
  private _stats = { hits: 0, misses: 0, evictions: 0 };
  private options: Required<CacheOptions>;

  constructor(options: CacheOptions = {}) {
    this.options = {
      defaultTtlMs: options.defaultTtlMs ?? 5 * 60 * 1000, // 5 minutes
      maxSize: options.maxSize ?? 1000,
      evictionPolicy: options.evictionPolicy ?? "lru",
      trackStats: options.trackStats ?? true,
    };
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      if (this.options.trackStats) this._stats.misses++;
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.delete(key);
      if (this.options.trackStats) this._stats.misses++;
      return undefined;
    }

    // Update access metadata
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    if (this.options.trackStats) this._stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.options.defaultTtlMs;
    const now = Date.now();

    // Evict if at capacity
    if (!this.entries.has(key) && this.entries.size >= this.options.maxSize) {
      this.evict();
    }

    // Track insert order for FIFO
    if (!this.entries.has(key)) {
      this.insertOrder.push(key);
    }

    this.entries.set(key, {
      value,
      expiresAt: now + ttl,
      createdAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    });
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) {
      const idx = this.insertOrder.indexOf(key);
      if (idx !== -1) this.insertOrder.splice(idx, 1);
    }
    return existed;
  }

  clear(): void {
    this.entries.clear();
    this.insertOrder = [];
  }

  stats(): CacheStats {
    const total = this._stats.hits + this._stats.misses;
    return {
      hits: this._stats.hits,
      misses: this._stats.misses,
      size: this.entries.size,
      evictions: this._stats.evictions,
      hitRate: total > 0 ? this._stats.hits / total : 0,
    };
  }

  keys(): string[] {
    // Only return non-expired keys
    const validKeys: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!this.isExpired(entry)) {
        validKeys.push(key);
      }
    }
    return validKeys;
  }

  size(): number {
    return this.entries.size;
  }

  invalidate(pattern: string | RegExp): number {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.entries.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        count++;
      }
    }

    return count;
  }

  getOrSet(key: string, factory: () => T, ttlMs?: number): T {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  async getOrSetAsync(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const existing = this.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  wrap<Args extends unknown[], R>(
    keyFn: (...args: Args) => string,
    fn: (...args: Args) => R,
    ttlMs?: number,
  ): (...args: Args) => R {
    return (...args: Args): R => {
      const key = keyFn(...args);
      return this.getOrSet(key, () => fn(...args) as unknown as T, ttlMs) as unknown as R;
    };
  }

  prune(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() >= entry.expiresAt;
  }

  private evict(): void {
    if (this.entries.size === 0) return;

    let keyToEvict: string | undefined;

    switch (this.options.evictionPolicy) {
      case "fifo":
        keyToEvict = this.insertOrder[0];
        break;

      case "lfu": {
        // Least frequently used
        let minAccess = Infinity;
        for (const [key, entry] of this.entries) {
          if (entry.accessCount < minAccess) {
            minAccess = entry.accessCount;
            keyToEvict = key;
          }
        }
        break;
      }

      case "lru":
      default: {
        // Least recently used
        let oldestAccess = Infinity;
        for (const [key, entry] of this.entries) {
          if (entry.lastAccessedAt < oldestAccess) {
            oldestAccess = entry.lastAccessedAt;
            keyToEvict = key;
          }
        }
        break;
      }
    }

    if (keyToEvict) {
      this.delete(keyToEvict);
      if (this.options.trackStats) this._stats.evictions++;
    }
  }
}

/**
 * Create a cache with the given options.
 */
export function createCache<T = unknown>(options?: CacheOptions): Cache<T> {
  return new MemoryCache<T>(options);
}

/**
 * Decorator for caching method results.
 */
export function cached(ttlMs?: number) {
  const cache = new MemoryCache<unknown>();

  return <T extends (...args: unknown[]) => unknown>(
    _target: object,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> => {
    const original = descriptor.value;
    if (!original) return descriptor;

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const key = `${propertyKey}:${JSON.stringify(args)}`;
      return cache.getOrSet(key, () => original.apply(this, args), ttlMs);
    } as T;

    return descriptor;
  };
}

/**
 * Multi-level cache (L1 memory + L2 optional).
 */
export class TieredCache<T = unknown> implements Cache<T> {
  private l1: Cache<T>;
  private l2?: Cache<T>;

  constructor(l1Options?: CacheOptions, l2?: Cache<T>) {
    this.l1 = new MemoryCache<T>(l1Options);
    if (l2) this.l2 = l2;
  }

  get(key: string): T | undefined {
    // Try L1 first
    let value = this.l1.get(key);
    if (value !== undefined) return value;

    // Try L2 if available
    if (this.l2) {
      value = this.l2.get(key);
      if (value !== undefined) {
        // Promote to L1
        this.l1.set(key, value);
        return value;
      }
    }

    return undefined;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.l1.set(key, value, ttlMs);
    this.l2?.set(key, value, ttlMs);
  }

  has(key: string): boolean {
    return this.l1.has(key) || (this.l2?.has(key) ?? false);
  }

  delete(key: string): boolean {
    const l1Deleted = this.l1.delete(key);
    const l2Deleted = this.l2?.delete(key) ?? false;
    return l1Deleted || l2Deleted;
  }

  clear(): void {
    this.l1.clear();
    this.l2?.clear();
  }

  stats(): CacheStats {
    return this.l1.stats();
  }

  keys(): string[] {
    const l1Keys = new Set(this.l1.keys());
    const l2Keys = this.l2?.keys() ?? [];
    for (const key of l2Keys) {
      l1Keys.add(key);
    }
    return Array.from(l1Keys);
  }

  size(): number {
    return this.l1.size();
  }

  invalidate(pattern: string | RegExp): number {
    const l1Count = this.l1.invalidate(pattern);
    const l2Count = this.l2?.invalidate(pattern) ?? 0;
    return l1Count + l2Count;
  }

  getOrSet(key: string, factory: () => T, ttlMs?: number): T {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  async getOrSetAsync(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  wrap<Args extends unknown[], R>(
    keyFn: (...args: Args) => string,
    fn: (...args: Args) => R,
    ttlMs?: number,
  ): (...args: Args) => R {
    return (...args: Args): R => {
      const key = keyFn(...args);
      return this.getOrSet(key, () => fn(...args) as unknown as T, ttlMs) as unknown as R;
    };
  }

  prune(): number {
    const l1Pruned = this.l1.prune();
    const l2Pruned = this.l2?.prune() ?? 0;
    return l1Pruned + l2Pruned;
  }
}
