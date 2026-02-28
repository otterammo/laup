import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiderAdapter } from "@laup/aider";
import { claudeCodeAdapter } from "@laup/claude-code";
import type { ToolAdapter } from "@laup/core";
import { cursorAdapter } from "@laup/cursor";
import { describe, expect, it } from "vitest";
import type { PropagationRecord } from "../index.js";
import { SyncEngine, Watcher } from "../index.js";

const ADAPTERS = [claudeCodeAdapter, cursorAdapter, aiderAdapter];

const VALID_CANONICAL = [
  "---",
  'version: "1.0"',
  "scope: project",
  "---",
  "",
  "# Instructions",
  "",
  "Always use TypeScript strict mode.",
].join("\n");

function makeTempDir(): string {
  const dir = join(tmpdir(), `laup-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTempSource(dir: string, content: string): string {
  const path = join(dir, "laup.md");
  writeFileSync(path, content, "utf-8");
  return path;
}

describe("SyncEngine", () => {
  describe("constructor", () => {
    it("registers adapters by toolId", () => {
      const engine = new SyncEngine(ADAPTERS);
      expect(engine.registeredTools).toContain("claude-code");
      expect(engine.registeredTools).toContain("cursor");
      expect(engine.registeredTools).toContain("aider");
    });
  });

  describe("validate()", () => {
    it("returns valid=true for a valid canonical file", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);
      const result = engine.validate(source);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("returns valid=false for an invalid canonical file", () => {
      const dir = makeTempDir();
      const source = writeTempSource(
        dir,
        ["---", 'version: "bad.version.format"', "---", "", "# Body", "", "Text."].join("\n"),
      );
      const engine = new SyncEngine(ADAPTERS);
      const result = engine.validate(source);
      expect(result.valid).toBe(false);
    });
  });

  describe("sync()", () => {
    it("syncs all registered adapters when tools array is empty", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      const results = engine.sync({ source, tools: [] });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("syncs only the requested tools", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      const results = engine.sync({ source, tools: ["claude-code"] });

      expect(results).toHaveLength(1);
      expect(results[0]?.tool).toBe("claude-code");
      expect(results[0]?.success).toBe(true);
    });

    it("writes CLAUDE.md for claude-code adapter", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      engine.sync({ source, tools: ["claude-code"] });

      const content = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
      expect(content).toContain("Always use TypeScript strict mode.");
    });

    it("writes .cursorrules for cursor adapter", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      engine.sync({ source, tools: ["cursor"] });

      const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
      expect(content).toContain("Always use TypeScript strict mode.");
    });

    it("writes .aider.conf.yml and CONVENTIONS.md for aider adapter", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      engine.sync({ source, tools: ["aider"] });

      const config = readFileSync(join(dir, ".aider.conf.yml"), "utf-8");
      expect(config).toContain("CONVENTIONS.md");

      const conventions = readFileSync(join(dir, "CONVENTIONS.md"), "utf-8");
      expect(conventions).toContain("Always use TypeScript strict mode.");
    });

    it("uses outputDir when specified", () => {
      const sourceDir = makeTempDir();
      const outputDir = join(tmpdir(), `laup-out-${randomUUID()}`);
      mkdirSync(outputDir, { recursive: true });
      const source = writeTempSource(sourceDir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      engine.sync({ source, tools: ["claude-code"], outputDir });

      const content = readFileSync(join(outputDir, "CLAUDE.md"), "utf-8");
      expect(content).toContain("Always use TypeScript strict mode.");
    });

    it("returns empty paths array in dry-run mode", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      const results = engine.sync({ source, tools: ["claude-code"], dryRun: true });

      expect(results[0]?.success).toBe(true);
      expect(results[0]?.paths).toHaveLength(0);
    });

    it("returns error result for unknown tool ID", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      const results = engine.sync({ source, tools: ["unknown-tool"] });

      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toContain("unknown-tool");
    });

    it("result.paths contains paths to all written files", () => {
      const dir = makeTempDir();
      const source = writeTempSource(dir, VALID_CANONICAL);
      const engine = new SyncEngine(ADAPTERS);

      const results = engine.sync({ source, tools: ["claude-code"] });

      expect(results[0]?.paths).toContain(join(dir, "CLAUDE.md"));
    });
  });
});

describe("Watcher", () => {
  it("creates a Watcher instance", () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const engine = new SyncEngine(ADAPTERS);
    const watcher = new Watcher(engine, { source, tools: ["claude-code"], debounceMs: 10 });
    expect(watcher).toBeInstanceOf(Watcher);
  });

  it("start() and stop() do not throw", () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const engine = new SyncEngine(ADAPTERS);
    const watcher = new Watcher(engine, { source, tools: [], debounceMs: 10 });
    expect(() => {
      watcher.start();
      watcher.stop();
    }).not.toThrow();
  });

  it("start() is idempotent — calling twice does not throw", () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const engine = new SyncEngine(ADAPTERS);
    const watcher = new Watcher(engine, { source, tools: [], debounceMs: 10 });
    expect(() => {
      watcher.start();
      watcher.start();
      watcher.stop();
    }).not.toThrow();
  });

  it("emits 'propagated' with success=true on triggerSync()", async () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const engine = new SyncEngine(ADAPTERS);
    const watcher = new Watcher(engine, { source, tools: ["claude-code"], debounceMs: 10 });

    const record = await new Promise<PropagationRecord>((resolve, reject) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        reject(new Error("Timeout waiting for 'propagated' event"));
      }, 2000);
      watcher.once("propagated", (r: unknown) => {
        clearTimeout(timer);
        resolve(r as PropagationRecord);
      });
      watcher.triggerSync();
    });

    watcher.stop();
    expect(record.success).toBe(true);
    expect(record.attempt).toBe(1);
    expect(record.results).toHaveLength(1);
    expect(record.results[0]?.success).toBe(true);
  });

  it("propagation record includes measurable latencyMs and startedAt", async () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const engine = new SyncEngine(ADAPTERS);
    const watcher = new Watcher(engine, { source, tools: ["claude-code"], debounceMs: 10 });

    const before = Date.now();
    const record = await new Promise<PropagationRecord>((resolve, reject) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => reject(new Error("Timeout")),
        2000,
      );
      watcher.once("propagated", (r: unknown) => {
        clearTimeout(timer);
        resolve(r as PropagationRecord);
      });
      watcher.triggerSync();
    });

    watcher.stop();
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.startedAt).toBeGreaterThanOrEqual(before);
  });

  it("retries on adapter failure and emits 'error' after exhausting retries", async () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const failingAdapter: ToolAdapter = {
      toolId: "fail-tool",
      displayName: "Fail",
      render(_doc) {
        throw new Error("simulated render failure");
      },
      write(_rendered, _targetDir) {
        return [];
      },
    };
    const engine = new SyncEngine([failingAdapter]);
    const watcher = new Watcher(engine, {
      source,
      tools: ["fail-tool"],
      debounceMs: 10,
      maxRetries: 2,
      retryBaseMs: 5,
    });

    const records: PropagationRecord[] = [];
    const err = await new Promise<Error>((resolve, reject) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => reject(new Error("Timeout waiting for 'error' event")),
        2000,
      );
      watcher.on("propagated", (r: unknown) => {
        records.push(r as PropagationRecord);
      });
      watcher.once("error", (e: unknown) => {
        clearTimeout(timer);
        resolve(e as Error);
      });
      watcher.triggerSync();
    });

    watcher.stop();

    // maxRetries=2 → initial attempt + 2 retries = 3 total propagated events
    expect(records).toHaveLength(3);
    expect(records.every((r) => !r.success)).toBe(true);
    expect(records[0]?.attempt).toBe(1);
    expect(records[1]?.attempt).toBe(2);
    expect(records[2]?.attempt).toBe(3);
    expect(err).toBeInstanceOf(Error);
  });

  it("propagation record error field is set when adapter fails", async () => {
    const dir = makeTempDir();
    const source = writeTempSource(dir, VALID_CANONICAL);
    const failingAdapter: ToolAdapter = {
      toolId: "fail-tool2",
      displayName: "Fail2",
      render(_doc) {
        throw new Error("render error msg");
      },
      write(_rendered, _targetDir) {
        return [];
      },
    };
    const engine = new SyncEngine([failingAdapter]);
    const watcher = new Watcher(engine, {
      source,
      tools: ["fail-tool2"],
      debounceMs: 10,
      maxRetries: 0,
      retryBaseMs: 5,
    });
    watcher.on("error", () => {
      // Suppress unhandled error event — maxRetries=0 emits error immediately
    });

    const record = await new Promise<PropagationRecord>((resolve, reject) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => reject(new Error("Timeout")),
        2000,
      );
      watcher.once("propagated", (r: unknown) => {
        clearTimeout(timer);
        resolve(r as PropagationRecord);
      });
      watcher.triggerSync();
    });

    watcher.stop();
    expect(record.success).toBe(false);
    expect(record.error).toBeDefined();
  });
});
