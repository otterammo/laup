import type { ToolCategory } from "./adapter.js";
import type {
  LlmUsage,
  McpInvocationUsage,
  MemoryOperationUsage,
  SkillInvocationUsage,
  UsageAttribution,
  UsageEvent,
  UsageEventType,
} from "./cost-schema.js";
import { UsageEventSchema } from "./cost-schema.js";
import type { UsageStorage } from "./usage-storage.js";

export interface UsageCollectorOptions {
  storage: UsageStorage;
  defaultAttribution?: UsageAttribution;
  now?: () => Date;
  idFactory?: () => string;
}

export interface UsageEventInputMap {
  "llm-call": LlmUsage;
  "mcp-invocation": McpInvocationUsage;
  "skill-invocation": SkillInvocationUsage;
  "memory-operation": MemoryOperationUsage;
}

export interface UsageCollector {
  collect<T extends UsageEventType>(
    type: T,
    data: UsageEventInputMap[T],
    attribution?: UsageAttribution,
  ): Promise<UsageEvent>;
  collectBatch(events: UsageCollectionInput[]): Promise<UsageEvent[]>;
  collectLlmCall(data: LlmUsage, attribution?: UsageAttribution): Promise<UsageEvent>;
  collectMcpInvocation(
    data: McpInvocationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent>;
  collectSkillInvocation(
    data: SkillInvocationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent>;
  collectMemoryOperation(
    data: MemoryOperationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent>;
}

export type UsageCollectionInput =
  | {
      type: "llm-call";
      data: LlmUsage;
      attribution?: UsageAttribution;
    }
  | {
      type: "mcp-invocation";
      data: McpInvocationUsage;
      attribution?: UsageAttribution;
    }
  | {
      type: "skill-invocation";
      data: SkillInvocationUsage;
      attribution?: UsageAttribution;
    }
  | {
      type: "memory-operation";
      data: MemoryOperationUsage;
      attribution?: UsageAttribution;
    };

export interface AdapterUsageContract {
  adapterId: string;
  category: ToolCategory | "memory" | "mcp" | "llm";
  attribution?: UsageAttribution;
}

export interface AdapterUsageEmitter {
  emitLlmCall(data: LlmUsage, attribution?: UsageAttribution): Promise<UsageEvent>;
  emitMcpInvocation(data: McpInvocationUsage, attribution?: UsageAttribution): Promise<UsageEvent>;
  emitSkillInvocation(
    data: SkillInvocationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent>;
  emitMemoryOperation(
    data: MemoryOperationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent>;
}

class DefaultUsageCollector implements UsageCollector {
  private readonly storage: UsageStorage;
  private readonly defaultAttribution: UsageAttribution;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: UsageCollectorOptions) {
    this.storage = options.storage;
    this.defaultAttribution = this.normalizeAttribution(options.defaultAttribution ?? {});
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ?? (() => `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  }

  async collect<T extends UsageEventType>(
    type: T,
    data: UsageEventInputMap[T],
    attribution?: UsageAttribution,
  ): Promise<UsageEvent> {
    const event: UsageEvent = UsageEventSchema.parse({
      id: this.idFactory(),
      type,
      timestamp: this.now().toISOString(),
      attribution: this.normalizeAttribution({
        ...this.defaultAttribution,
        ...(attribution ?? {}),
      }),
      data,
    });

    await this.storage.store(event);
    return event;
  }

  async collectBatch(events: UsageCollectionInput[]): Promise<UsageEvent[]> {
    const normalized = events.map((event) =>
      UsageEventSchema.parse({
        id: this.idFactory(),
        type: event.type,
        timestamp: this.now().toISOString(),
        attribution: this.normalizeAttribution({
          ...this.defaultAttribution,
          ...(event.attribution ?? {}),
        }),
        data: event.data,
      }),
    );

    await this.storage.storeBatch(normalized);
    return normalized;
  }

  private normalizeAttribution(attribution: UsageAttribution): UsageAttribution {
    const developerId = attribution.developerId ?? attribution.userId;
    const userId = attribution.userId ?? attribution.developerId;

    return {
      ...attribution,
      developerId,
      userId,
    };
  }

  collectLlmCall(data: LlmUsage, attribution?: UsageAttribution): Promise<UsageEvent> {
    return this.collect("llm-call", data, attribution);
  }

  collectMcpInvocation(
    data: McpInvocationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent> {
    return this.collect("mcp-invocation", data, attribution);
  }

  collectSkillInvocation(
    data: SkillInvocationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent> {
    return this.collect("skill-invocation", data, attribution);
  }

  collectMemoryOperation(
    data: MemoryOperationUsage,
    attribution?: UsageAttribution,
  ): Promise<UsageEvent> {
    return this.collect("memory-operation", data, attribution);
  }
}

export function createUsageCollector(options: UsageCollectorOptions): UsageCollector {
  return new DefaultUsageCollector(options);
}

export function createAdapterUsageEmitter(
  collector: UsageCollector,
  contract: AdapterUsageContract,
): AdapterUsageEmitter {
  const baseAttribution: UsageAttribution = {
    adapterId: contract.adapterId,
    toolCategory: contract.category,
    ...(contract.attribution ?? {}),
  };

  const merge = (attribution?: UsageAttribution): UsageAttribution => ({
    ...baseAttribution,
    ...(attribution ?? {}),
  });

  return {
    emitLlmCall: (data, attribution) => collector.collectLlmCall(data, merge(attribution)),
    emitMcpInvocation: (data, attribution) =>
      collector.collectMcpInvocation(data, merge(attribution)),
    emitSkillInvocation: (data, attribution) =>
      collector.collectSkillInvocation(data, merge(attribution)),
    emitMemoryOperation: (data, attribution) =>
      collector.collectMemoryOperation(data, merge(attribution)),
  };
}
