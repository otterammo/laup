/**
 * Data export utilities (INFRA-008).
 * Export data to CSV/JSON formats for reporting and compliance.
 */

/**
 * Export format.
 */
export type ExportFormat = "json" | "csv" | "jsonl";

/**
 * Export options.
 */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;

  /** Fields to include (default: all) */
  fields?: string[];

  /** Fields to exclude */
  excludeFields?: string[];

  /** Date range start */
  startDate?: Date;

  /** Date range end */
  endDate?: Date;

  /** Pretty print JSON */
  pretty?: boolean;

  /** Include headers in CSV */
  includeHeaders?: boolean;

  /** CSV delimiter */
  delimiter?: string;

  /** Batch size for streaming */
  batchSize?: number;
}

/**
 * Export result.
 */
export interface ExportResult {
  /** Exported data as string */
  data: string;

  /** Number of records exported */
  recordCount: number;

  /** Export format used */
  format: ExportFormat;

  /** Fields included */
  fields: string[];

  /** Export timestamp */
  exportedAt: string;
}

/**
 * Streaming export handler.
 */
export interface StreamingExporter {
  /** Write a batch of records */
  write(records: Record<string, unknown>[]): Promise<void>;

  /** Finalize and get result */
  finalize(): Promise<ExportResult>;
}

/**
 * Extract value from nested object path.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Flatten nested object to dot-notation keys.
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
  result: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      flattenObject(value as Record<string, unknown>, newKey, result);
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/**
 * Get all unique field names from records.
 */
function getAllFields(records: Record<string, unknown>[]): string[] {
  const fields = new Set<string>();

  for (const record of records) {
    const flat = flattenObject(record);
    for (const key of Object.keys(flat)) {
      fields.add(key);
    }
  }

  return Array.from(fields).sort();
}

/**
 * Filter fields based on include/exclude options.
 */
function filterFields(allFields: string[], options: ExportOptions): string[] {
  let fields = allFields;

  if (options.fields?.length) {
    fields = options.fields.filter((f) => allFields.includes(f));
  }

  if (options.excludeFields?.length) {
    fields = fields.filter((f) => !options.excludeFields!.includes(f));
  }

  return fields;
}

/**
 * Escape CSV value.
 */
function escapeCsvValue(value: unknown, delimiter = ","): string {
  if (value === null || value === undefined) return "";

  const str = typeof value === "object" ? JSON.stringify(value) : String(value);

  // Escape if contains delimiter, quote, or newline
  if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Export records to JSON format.
 */
export function exportToJson(
  records: Record<string, unknown>[],
  options: Partial<ExportOptions> = {},
): ExportResult {
  const allFields = getAllFields(records);
  const fields = filterFields(allFields, { format: "json", ...options });

  const filteredRecords = records.map((record) => {
    const flat = flattenObject(record);
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in flat) {
        result[field] = flat[field];
      }
    }
    return result;
  });

  const data = options.pretty
    ? JSON.stringify(filteredRecords, null, 2)
    : JSON.stringify(filteredRecords);

  return {
    data,
    recordCount: records.length,
    format: "json",
    fields,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Export records to JSON Lines format.
 */
export function exportToJsonl(
  records: Record<string, unknown>[],
  options: Partial<ExportOptions> = {},
): ExportResult {
  const allFields = getAllFields(records);
  const fields = filterFields(allFields, { format: "jsonl", ...options });

  const lines = records.map((record) => {
    const flat = flattenObject(record);
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in flat) {
        result[field] = flat[field];
      }
    }
    return JSON.stringify(result);
  });

  return {
    data: lines.join("\n"),
    recordCount: records.length,
    format: "jsonl",
    fields,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Export records to CSV format.
 */
export function exportToCsv(
  records: Record<string, unknown>[],
  options: Partial<ExportOptions> = {},
): ExportResult {
  const delimiter = options.delimiter ?? ",";
  const includeHeaders = options.includeHeaders !== false;

  const allFields = getAllFields(records);
  const fields = filterFields(allFields, { format: "csv", ...options });

  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(fields.map((f) => escapeCsvValue(f, delimiter)).join(delimiter));
  }

  for (const record of records) {
    const flat = flattenObject(record);
    const values = fields.map((field) => escapeCsvValue(flat[field], delimiter));
    lines.push(values.join(delimiter));
  }

  return {
    data: lines.join("\n"),
    recordCount: records.length,
    format: "csv",
    fields,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Export records to the specified format.
 */
export function exportData(
  records: Record<string, unknown>[],
  options: ExportOptions,
): ExportResult {
  switch (options.format) {
    case "json":
      return exportToJson(records, options);
    case "jsonl":
      return exportToJsonl(records, options);
    case "csv":
      return exportToCsv(records, options);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

/**
 * Create a streaming exporter for large datasets.
 */
export function createStreamingExporter(options: ExportOptions): StreamingExporter {
  const batches: Record<string, unknown>[][] = [];
  const allFields: string[] = [];

  return {
    async write(records: Record<string, unknown>[]): Promise<void> {
      batches.push(records);

      // Collect all fields
      const newFields = getAllFields(records);
      for (const field of newFields) {
        if (!allFields.includes(field)) {
          allFields.push(field);
        }
      }
    },

    async finalize(): Promise<ExportResult> {
      const allRecords = batches.flat();
      allFields.sort();

      return exportData(allRecords, { ...options, fields: options.fields ?? allFields });
    },
  };
}

/**
 * Parse date filter from options.
 */
export function filterByDateRange<T extends { timestamp?: string; createdAt?: string }>(
  records: T[],
  options: Pick<ExportOptions, "startDate" | "endDate">,
): T[] {
  return records.filter((record) => {
    const dateStr = record.timestamp ?? record.createdAt;
    if (!dateStr) return true;

    const date = new Date(dateStr);

    if (options.startDate && date < options.startDate) return false;
    if (options.endDate && date >= options.endDate) return false;

    return true;
  });
}

/**
 * Export usage data specifically.
 */
export interface UsageExportOptions extends ExportOptions {
  /** Group by dimension */
  groupBy?: "user" | "project" | "team" | "model" | "day" | "week" | "month";

  /** Include cost calculations */
  includeCosts?: boolean;

  /** Aggregate totals */
  aggregate?: boolean;
}

/**
 * Aggregate usage records by dimension.
 */
export function aggregateUsageRecords(
  records: Record<string, unknown>[],
  groupBy: UsageExportOptions["groupBy"],
): Record<string, unknown>[] {
  if (!groupBy) return records;

  const groups = new Map<string, Record<string, unknown>>();

  for (const record of records) {
    let key: string;

    switch (groupBy) {
      case "user":
        key = String(getNestedValue(record, "attribution.userId") ?? "unknown");
        break;
      case "project":
        key = String(getNestedValue(record, "attribution.projectId") ?? "unknown");
        break;
      case "team":
        key = String(getNestedValue(record, "attribution.teamId") ?? "unknown");
        break;
      case "model":
        key = String(getNestedValue(record, "data.model") ?? "unknown");
        break;
      case "day":
      case "week":
      case "month": {
        const ts = record["timestamp"] as string | undefined;
        if (!ts) {
          key = "unknown";
        } else {
          const date = new Date(ts);
          if (groupBy === "day") {
            key = date.toISOString().slice(0, 10);
          } else if (groupBy === "week") {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            key = weekStart.toISOString().slice(0, 10);
          } else {
            key = date.toISOString().slice(0, 7);
          }
        }
        break;
      }
      default:
        key = "all";
    }

    const existing = groups.get(key) ?? {
      [groupBy]: key,
      totalRecords: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };

    existing["totalRecords"] = (existing["totalRecords"] as number) + 1;
    const inputTokens = getNestedValue(record, "data.inputTokens");
    const outputTokens = getNestedValue(record, "data.outputTokens");

    if (typeof inputTokens === "number") {
      existing["totalInputTokens"] = (existing["totalInputTokens"] as number) + inputTokens;
    }
    if (typeof outputTokens === "number") {
      existing["totalOutputTokens"] = (existing["totalOutputTokens"] as number) + outputTokens;
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values());
}
