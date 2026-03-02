/**
 * Background job queue (INFRA-010).
 * Async job processing with retry support.
 */

/**
 * Job priority levels.
 */
export type JobPriority = "low" | "normal" | "high" | "critical";

/**
 * Job status.
 */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "dead";

/**
 * Job definition.
 */
export interface Job<T = unknown> {
  /** Unique job ID */
  id: string;

  /** Job type/name */
  type: string;

  /** Job payload */
  payload: T;

  /** Priority level */
  priority: JobPriority;

  /** Current status */
  status: JobStatus;

  /** Number of attempts made */
  attempts: number;

  /** Maximum retry attempts */
  maxRetries: number;

  /** Delay before first execution (ms) */
  delay?: number;

  /** Created timestamp */
  createdAt: string;

  /** Scheduled execution time */
  scheduledAt?: string;

  /** Started execution time */
  startedAt?: string;

  /** Completed/failed time */
  finishedAt?: string;

  /** Error message (if failed) */
  error?: string;

  /** Result data (if completed) */
  result?: unknown;

  /** Retry backoff strategy */
  backoff?: "fixed" | "exponential";

  /** Base delay for retries (ms) */
  retryDelay?: number;
}

/**
 * Job handler function.
 */
export type JobHandler<T = unknown, R = unknown> = (payload: T, job: Job<T>) => Promise<R>;

/**
 * Job queue options.
 */
export interface JobQueueOptions {
  /** Maximum concurrent jobs */
  concurrency?: number;

  /** Default max retries */
  defaultMaxRetries?: number;

  /** Default retry delay (ms) */
  defaultRetryDelay?: number;

  /** Poll interval when idle (ms) */
  pollInterval?: number;
}

/**
 * Job queue statistics.
 */
export interface JobQueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  dead: number;
  total: number;
}

/**
 * Job queue interface.
 */
export interface JobQueue {
  /** Register a handler for a job type */
  register<T, R>(type: string, handler: JobHandler<T, R>): void;

  /** Enqueue a new job */
  enqueue<T>(
    type: string,
    payload: T,
    options?: Partial<Pick<Job, "priority" | "delay" | "maxRetries" | "backoff" | "retryDelay">>,
  ): Promise<string>;

  /** Get a job by ID */
  get(id: string): Promise<Job | null>;

  /** Cancel a pending job */
  cancel(id: string): Promise<boolean>;

  /** Retry a failed job */
  retry(id: string): Promise<boolean>;

  /** Get queue statistics */
  stats(): Promise<JobQueueStats>;

  /** Get jobs by status */
  list(status?: JobStatus, limit?: number): Promise<Job[]>;

  /** Get dead letter queue */
  deadLetter(limit?: number): Promise<Job[]>;

  /** Purge completed jobs older than age */
  purge(olderThanMs: number): Promise<number>;

  /** Start processing jobs */
  start(): void;

  /** Stop processing jobs */
  stop(): void;

  /** Check if queue is running */
  isRunning(): boolean;

  /** Wait for all jobs to complete */
  drain(): Promise<void>;
}

/**
 * Priority weight for sorting.
 */
const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * In-memory job queue implementation.
 */
export class MemoryJobQueue implements JobQueue {
  private jobs: Map<string, Job> = new Map();
  private handlers: Map<string, JobHandler> = new Map();
  private running = false;
  private activeJobs = 0;
  private nextId = 1;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private drainResolvers: Array<() => void> = [];

  private options: Required<JobQueueOptions>;

  constructor(options: JobQueueOptions = {}) {
    this.options = {
      concurrency: options.concurrency ?? 5,
      defaultMaxRetries: options.defaultMaxRetries ?? 3,
      defaultRetryDelay: options.defaultRetryDelay ?? 1000,
      pollInterval: options.pollInterval ?? 100,
    };
  }

  register<T, R>(type: string, handler: JobHandler<T, R>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  async enqueue<T>(
    type: string,
    payload: T,
    options?: Partial<Pick<Job, "priority" | "delay" | "maxRetries" | "backoff" | "retryDelay">>,
  ): Promise<string> {
    const id = `job_${this.nextId++}`;
    const now = new Date();

    const job: Job<T> = {
      id,
      type,
      payload,
      priority: options?.priority ?? "normal",
      status: "pending",
      attempts: 0,
      maxRetries: options?.maxRetries ?? this.options.defaultMaxRetries,
      createdAt: now.toISOString(),
      backoff: options?.backoff ?? "exponential",
      retryDelay: options?.retryDelay ?? this.options.defaultRetryDelay,
    };

    if (options?.delay) {
      job.delay = options.delay;
      job.scheduledAt = new Date(now.getTime() + options.delay).toISOString();
    }

    this.jobs.set(id, job as Job);
    return id;
  }

  async get(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || job.status !== "pending") return false;

    this.jobs.delete(id);
    return true;
  }

  async retry(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || (job.status !== "failed" && job.status !== "dead")) return false;

    job.status = "pending";
    job.attempts = 0;
    delete job.error;
    delete job.startedAt;
    delete job.finishedAt;

    return true;
  }

  async stats(): Promise<JobQueueStats> {
    const stats: JobQueueStats = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      dead: 0,
      total: 0,
    };

    for (const job of this.jobs.values()) {
      stats[job.status]++;
      stats.total++;
    }

    return stats;
  }

  async list(status?: JobStatus, limit = 100): Promise<Job[]> {
    const jobs = Array.from(this.jobs.values());

    const filtered = status ? jobs.filter((j) => j.status === status) : jobs;

    return filtered.slice(0, limit);
  }

  async deadLetter(limit = 100): Promise<Job[]> {
    return this.list("dead", limit);
  }

  async purge(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let purged = 0;

    for (const [id, job] of this.jobs) {
      if (job.status === "completed" && job.finishedAt) {
        if (new Date(job.finishedAt).getTime() < cutoff) {
          this.jobs.delete(id);
          purged++;
        }
      }
    }

    return purged;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async drain(): Promise<void> {
    if (this.activeJobs === 0) {
      const pending = await this.list("pending");
      if (pending.length === 0) return;
    }

    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private poll(): void {
    if (!this.running) return;

    this.processNext();

    this.pollTimer = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  private async processNext(): Promise<void> {
    if (this.activeJobs >= this.options.concurrency) return;

    const job = this.getNextJob();
    if (!job) {
      this.checkDrain();
      return;
    }

    this.activeJobs++;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.attempts++;

    try {
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      const result = await handler(job.payload, job);
      job.status = "completed";
      job.result = result;
      job.finishedAt = new Date().toISOString();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (job.attempts < job.maxRetries) {
        // Retry
        job.status = "pending";
        job.error = errorMsg;

        const delay = this.calculateRetryDelay(job);
        job.scheduledAt = new Date(Date.now() + delay).toISOString();
      } else {
        // Move to dead letter queue
        job.status = "dead";
        job.error = errorMsg;
        job.finishedAt = new Date().toISOString();
      }
    } finally {
      this.activeJobs--;
      this.checkDrain();
    }
  }

  private getNextJob(): Job | undefined {
    const now = Date.now();
    const pendingJobs: Job[] = [];

    for (const job of this.jobs.values()) {
      if (job.status !== "pending") continue;

      // Check if scheduled for later
      if (job.scheduledAt && new Date(job.scheduledAt).getTime() > now) {
        continue;
      }

      pendingJobs.push(job);
    }

    if (pendingJobs.length === 0) return undefined;

    // Sort by priority (highest first), then by created time
    pendingJobs.sort((a, b) => {
      const priorityDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return pendingJobs[0];
  }

  private calculateRetryDelay(job: Job): number {
    const baseDelay = job.retryDelay ?? this.options.defaultRetryDelay;

    if (job.backoff === "fixed") {
      return baseDelay;
    }

    // Exponential backoff
    return baseDelay * 2 ** (job.attempts - 1);
  }

  private checkDrain(): void {
    if (this.activeJobs > 0) return;

    // Check if any pending jobs
    for (const job of this.jobs.values()) {
      if (job.status === "pending") return;
    }

    // Resolve all drain promises
    for (const resolve of this.drainResolvers) {
      resolve();
    }
    this.drainResolvers = [];
  }
}

/**
 * Create a job queue with the given options.
 */
export function createJobQueue(options?: JobQueueOptions): JobQueue {
  return new MemoryJobQueue(options);
}
