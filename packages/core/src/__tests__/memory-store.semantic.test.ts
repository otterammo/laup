import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  createSemanticMemoryStore,
  type MemoryEmbeddingProvider,
  type MemoryWriteInput,
} from "../memory-store.js";

class KeywordEmbeddingProvider implements MemoryEmbeddingProvider {
  constructor(private readonly dimensions: string[]) {}

  async embed(input: string, options?: { model?: string }): Promise<number[]> {
    const text = input.toLowerCase();
    const base = this.dimensions.map((dimension) => {
      const escaped = dimension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = text.match(new RegExp(`\\b${escaped}\\b`, "g"));
      return matches?.length ?? 0;
    });

    if (options?.model === "alt-model") {
      return base.map((value, index) => (index === 0 ? value + 0.01 : value));
    }
    return base;
  }
}

const ORG_CONTEXT = { orgId: "org-1" };
const PROJECT_CONTEXT = { orgId: "org-1", projectId: "proj-1" };

function projectMemory(input: { id: string; content: string }): MemoryWriteInput {
  return { ...input, scope: "project", context: PROJECT_CONTEXT };
}

describe("memory-store semantic retrieval", () => {
  it("embeds memories on write using the configured model", async () => {
    const calls: Array<{ input: string; model?: string }> = [];
    const provider: MemoryEmbeddingProvider = {
      embed: async (input, options) => {
        const call: { input: string; model?: string } = { input };
        if (options?.model) call.model = options.model;
        calls.push(call);
        return [1, 0, 0];
      },
    };

    const store = createSemanticMemoryStore({
      embeddingProvider: provider,
      defaultEmbeddingModel: "test-model-v1",
    });

    await store.write({
      content: "Remember to deploy at 5pm.",
      scope: "org",
      context: ORG_CONTEXT,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("test-model-v1");
  });

  it("returns results ranked by cosine similarity", async () => {
    const provider = new KeywordEmbeddingProvider(["deploy", "database", "vacation"]);
    const store = createSemanticMemoryStore({ embeddingProvider: provider });

    await store.writeBatch([
      projectMemory({ id: "m1", content: "Deploy the database migration before release." }),
      projectMemory({ id: "m2", content: "Book vacation for next month." }),
      projectMemory({ id: "m3", content: "Prepare deployment checklist and runbook." }),
    ]);

    const results = await store.semanticSearch(
      "How should we deploy the database?",
      "project",
      PROJECT_CONTEXT,
      { k: 3 },
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.memory.id).toBe("m1");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("uses configurable top-k with default=10", async () => {
    const provider = new KeywordEmbeddingProvider(["task"]);
    const store = createSemanticMemoryStore({ embeddingProvider: provider });

    await store.writeBatch(
      Array.from({ length: 15 }).map((_, index) =>
        projectMemory({ id: `m${index + 1}`, content: `task ${index + 1}` }),
      ),
    );

    const defaultResults = await store.semanticSearch("task", "project", PROJECT_CONTEXT);
    expect(defaultResults).toHaveLength(10);

    const topThree = await store.semanticSearch("task", "project", PROJECT_CONTEXT, { k: 3 });
    expect(topThree).toHaveLength(3);
  });

  it("keeps p95 search latency under 500ms for typical batch size", async () => {
    const provider = new KeywordEmbeddingProvider([
      "deploy",
      "database",
      "incident",
      "policy",
      "release",
      "auth",
      "cache",
      "billing",
      "search",
      "latency",
    ]);
    const store = createSemanticMemoryStore({ embeddingProvider: provider });

    await store.writeBatch(
      Array.from({ length: 600 }).map((_, index) =>
        projectMemory({
          id: `mem-${index + 1}`,
          content: `release policy auth deploy database search latency note ${index + 1}`,
        }),
      ),
    );

    const latenciesMs: number[] = [];
    for (let i = 0; i < 75; i += 1) {
      const start = performance.now();
      await store.semanticSearch(
        "find release notes about deploy database latency",
        "project",
        PROJECT_CONTEXT,
        { k: 10 },
      );
      latenciesMs.push(performance.now() - start);
    }

    latenciesMs.sort((a, b) => a - b);
    const p95Index = Math.floor(latenciesMs.length * 0.95) - 1;
    const p95 = latenciesMs[Math.max(0, p95Index)] ?? Infinity;

    expect(p95).toBeLessThan(500);
  });
});

describe("cosineSimilarity", () => {
  it("returns 0 for mismatched vectors and zero vectors", () => {
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("computes expected similarity", () => {
    const score = cosineSimilarity([1, 1], [1, 0]);
    expect(score).toBeCloseTo(0.7071, 3);
  });
});
