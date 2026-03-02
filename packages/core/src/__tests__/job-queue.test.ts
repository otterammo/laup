import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobQueue, type JobQueue } from "../job-queue.js";

describe("job-queue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = createJobQueue({ pollInterval: 10 });
  });

  afterEach(() => {
    queue.stop();
  });

  describe("enqueue", () => {
    it("enqueues a job and returns an id", async () => {
      const id = await queue.enqueue("test", { data: "hello" });
      expect(id).toMatch(/^job_/);
    });

    it("stores job with correct properties", async () => {
      const id = await queue.enqueue("email", { to: "test@example.com" });
      const job = await queue.get(id);

      expect(job?.type).toBe("email");
      expect(job?.payload).toEqual({ to: "test@example.com" });
      expect(job?.status).toBe("pending");
      expect(job?.priority).toBe("normal");
    });

    it("accepts priority option", async () => {
      const id = await queue.enqueue("test", {}, { priority: "high" });
      const job = await queue.get(id);
      expect(job?.priority).toBe("high");
    });

    it("accepts delay option", async () => {
      const id = await queue.enqueue("test", {}, { delay: 5000 });
      const job = await queue.get(id);
      expect(job?.delay).toBe(5000);
      expect(job?.scheduledAt).toBeDefined();
    });
  });

  describe("get", () => {
    it("returns job by id", async () => {
      const id = await queue.enqueue("test", { value: 42 });
      const job = await queue.get(id);
      expect(job?.payload).toEqual({ value: 42 });
    });

    it("returns null for unknown id", async () => {
      const job = await queue.get("unknown");
      expect(job).toBeNull();
    });
  });

  describe("cancel", () => {
    it("cancels pending job", async () => {
      const id = await queue.enqueue("test", {});
      const result = await queue.cancel(id);

      expect(result).toBe(true);
      expect(await queue.get(id)).toBeNull();
    });

    it("returns false for non-pending job", async () => {
      queue.register("test", async () => "done");
      const id = await queue.enqueue("test", {});

      queue.start();
      await new Promise((r) => setTimeout(r, 50));

      const result = await queue.cancel(id);
      expect(result).toBe(false);
    });
  });

  describe("processing", () => {
    it("processes jobs when started", async () => {
      const handler = vi.fn(async (payload: { n: number }) => payload.n * 2);
      queue.register("double", handler);

      await queue.enqueue("double", { n: 5 });
      queue.start();

      await new Promise((r) => setTimeout(r, 50));

      expect(handler).toHaveBeenCalledWith({ n: 5 }, expect.any(Object));
    });

    it("stores result on completion", async () => {
      queue.register("compute", async () => ({ answer: 42 }));

      const id = await queue.enqueue("compute", {});
      queue.start();

      await new Promise((r) => setTimeout(r, 50));

      const job = await queue.get(id);
      expect(job?.status).toBe("completed");
      expect(job?.result).toEqual({ answer: 42 });
    });

    it("handles errors and retries", async () => {
      let attempts = 0;
      queue.register("flaky", async () => {
        attempts++;
        if (attempts < 2) throw new Error("Flaky failure");
        return "success";
      });

      const id = await queue.enqueue("flaky", {}, { maxRetries: 3, retryDelay: 10 });
      queue.start();

      await new Promise((r) => setTimeout(r, 100));

      const job = await queue.get(id);
      expect(job?.status).toBe("completed");
      expect(attempts).toBe(2);
    });

    it("moves to dead letter after max retries", async () => {
      queue.register("alwaysFails", async () => {
        throw new Error("Always fails");
      });

      const id = await queue.enqueue("alwaysFails", {}, { maxRetries: 2, retryDelay: 10 });
      queue.start();

      await new Promise((r) => setTimeout(r, 150));

      const job = await queue.get(id);
      expect(job?.status).toBe("dead");
      expect(job?.error).toBe("Always fails");
    });

    it("respects concurrency limit", async () => {
      const concurrentQueue = createJobQueue({ concurrency: 2, pollInterval: 10 });
      let concurrent = 0;
      let maxConcurrent = 0;

      concurrentQueue.register("slow", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 30));
        concurrent--;
      });

      await concurrentQueue.enqueue("slow", {});
      await concurrentQueue.enqueue("slow", {});
      await concurrentQueue.enqueue("slow", {});

      concurrentQueue.start();
      await new Promise((r) => setTimeout(r, 150));

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      concurrentQueue.stop();
    });
  });

  describe("priority", () => {
    it("processes higher priority jobs first", async () => {
      const order: string[] = [];

      queue.register("track", async (payload: { name: string }) => {
        order.push(payload.name);
      });

      await queue.enqueue("track", { name: "low" }, { priority: "low" });
      await queue.enqueue("track", { name: "high" }, { priority: "high" });
      await queue.enqueue("track", { name: "critical" }, { priority: "critical" });
      await queue.enqueue("track", { name: "normal" }, { priority: "normal" });

      queue.start();
      await new Promise((r) => setTimeout(r, 100));

      expect(order[0]).toBe("critical");
      expect(order[1]).toBe("high");
    });
  });

  describe("retry", () => {
    it("retries a failed job", async () => {
      let shouldFail = true;
      queue.register("retriable", async () => {
        if (shouldFail) throw new Error("First fail");
        return "success";
      });

      const id = await queue.enqueue("retriable", {}, { maxRetries: 1, retryDelay: 10 });
      queue.start();

      await new Promise((r) => setTimeout(r, 50));

      let job = await queue.get(id);
      expect(job?.status).toBe("dead");

      shouldFail = false;
      await queue.retry(id);

      await new Promise((r) => setTimeout(r, 50));

      job = await queue.get(id);
      expect(job?.status).toBe("completed");
    });
  });

  describe("stats", () => {
    it("returns queue statistics", async () => {
      queue.register("test", async () => "done");

      await queue.enqueue("test", {});
      await queue.enqueue("test", {});

      const stats = await queue.stats();
      expect(stats.pending).toBe(2);
      expect(stats.total).toBe(2);

      queue.start();
      await new Promise((r) => setTimeout(r, 50));

      const afterStats = await queue.stats();
      expect(afterStats.completed).toBe(2);
    });
  });

  describe("list", () => {
    it("lists jobs by status", async () => {
      queue.register("test", async () => "done");

      await queue.enqueue("test", {});
      await queue.enqueue("test", {});

      const pending = await queue.list("pending");
      expect(pending).toHaveLength(2);

      queue.start();
      await new Promise((r) => setTimeout(r, 50));

      const completed = await queue.list("completed");
      expect(completed).toHaveLength(2);
    });
  });

  describe("deadLetter", () => {
    it("returns dead letter jobs", async () => {
      queue.register("fail", async () => {
        throw new Error("Fail");
      });

      await queue.enqueue("fail", {}, { maxRetries: 1, retryDelay: 10 });
      queue.start();

      await new Promise((r) => setTimeout(r, 100));

      const dead = await queue.deadLetter();
      expect(dead).toHaveLength(1);
      expect(dead[0]?.status).toBe("dead");
    });
  });

  describe("purge", () => {
    it("purges old completed jobs", async () => {
      queue.register("test", async () => "done");

      await queue.enqueue("test", {});
      queue.start();

      await new Promise((r) => setTimeout(r, 50));

      // Purge jobs older than 0ms (all completed)
      const purged = await queue.purge(0);
      expect(purged).toBe(1);

      const remaining = await queue.list("completed");
      expect(remaining).toHaveLength(0);
    });
  });

  describe("drain", () => {
    it("waits for all jobs to complete", async () => {
      queue.register("slow", async () => {
        await new Promise((r) => setTimeout(r, 30));
        return "done";
      });

      await queue.enqueue("slow", {});
      await queue.enqueue("slow", {});

      queue.start();
      await queue.drain();

      const stats = await queue.stats();
      expect(stats.completed).toBe(2);
      expect(stats.pending).toBe(0);
    });
  });

  describe("start/stop", () => {
    it("isRunning reflects state", () => {
      expect(queue.isRunning()).toBe(false);
      queue.start();
      expect(queue.isRunning()).toBe(true);
      queue.stop();
      expect(queue.isRunning()).toBe(false);
    });
  });
});
