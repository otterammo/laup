import type { EvaluationContext } from "./evaluation-context.js";
import type { PolicyCondition } from "./policy-evaluator.js";

export interface ConditionalDimensions {
  role?: string;
  roles?: string[];
  project?: string;
  branch?: string;
  tool?: string;
  day?: string;
  time?: string;
  timeMinutes?: number;
}

const DAY_LABELS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const pad2 = (value: number): string => value.toString().padStart(2, "0");

const parseTimeMinutes = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const matchesTimeWindow = (timeMinutes: number | undefined, expected: unknown): boolean => {
  if (timeMinutes === undefined) return false;

  const windows = Array.isArray(expected) ? expected : [expected];
  for (const windowValue of windows) {
    if (typeof windowValue !== "string") {
      continue;
    }

    const [startRaw, endRaw] = windowValue.split("-");
    if (!startRaw || !endRaw) {
      continue;
    }

    const start = parseTimeMinutes(startRaw);
    const end = parseTimeMinutes(endRaw);
    if (start === null || end === null) {
      continue;
    }

    if (start <= end) {
      if (timeMinutes >= start && timeMinutes <= end) {
        return true;
      }
      continue;
    }

    // Overnight window, e.g. 22:00-04:00
    if (timeMinutes >= start || timeMinutes <= end) {
      return true;
    }
  }

  return false;
};

const getFieldValue = (
  field: string,
  context: EvaluationContext,
  dimensions: ConditionalDimensions,
): unknown => {
  const fromDimensions = dimensions[field as keyof ConditionalDimensions];
  if (fromDimensions !== undefined) {
    return fromDimensions;
  }

  const parts = field.split(".");
  let value: unknown = context;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value !== "object") {
      return undefined;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return value;
};

const evaluateCondition = (
  condition: PolicyCondition,
  context: EvaluationContext,
  dimensions: ConditionalDimensions,
): boolean => {
  const fieldValue = getFieldValue(condition.field, context, dimensions);

  if (condition.field === "timeWindow") {
    return matchesTimeWindow(dimensions.timeMinutes, condition.value);
  }

  switch (condition.operator) {
    case "eq":
      return fieldValue === condition.value;
    case "neq":
      return fieldValue !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(fieldValue as never);
    case "nin":
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue as never);
    case "contains":
      return Array.isArray(fieldValue)
        ? fieldValue.includes(condition.value as never)
        : typeof fieldValue === "string" && typeof condition.value === "string"
          ? fieldValue.includes(condition.value)
          : false;
    case "exists":
      return condition.value ? fieldValue !== undefined : fieldValue === undefined;
    case "regex":
      return typeof fieldValue === "string" && typeof condition.value === "string"
        ? new RegExp(condition.value).test(fieldValue)
        : false;
    case "gt":
      return (
        typeof fieldValue === "number" &&
        typeof condition.value === "number" &&
        fieldValue > condition.value
      );
    case "gte":
      return (
        typeof fieldValue === "number" &&
        typeof condition.value === "number" &&
        fieldValue >= condition.value
      );
    case "lt":
      return (
        typeof fieldValue === "number" &&
        typeof condition.value === "number" &&
        fieldValue < condition.value
      );
    case "lte":
      return (
        typeof fieldValue === "number" &&
        typeof condition.value === "number" &&
        fieldValue <= condition.value
      );
    default:
      return false;
  }
};

export function deriveConditionalDimensions(context: EvaluationContext): ConditionalDimensions {
  const actorAttrs = context.actor.attributes ?? {};
  const env = context.environment ?? {};

  const roles = Array.isArray(actorAttrs["roles"])
    ? actorAttrs["roles"].filter((value): value is string => typeof value === "string")
    : [];

  const role =
    typeof actorAttrs["role"] === "string"
      ? actorAttrs["role"]
      : roles.length > 0
        ? roles[0]
        : typeof env["role"] === "string"
          ? env["role"]
          : undefined;

  const project =
    typeof env["project"] === "string"
      ? env["project"]
      : typeof context.resource.attributes?.["project"] === "string"
        ? (context.resource.attributes["project"] as string)
        : undefined;

  const branch =
    typeof env["branch"] === "string"
      ? env["branch"]
      : typeof context.resource.attributes?.["branch"] === "string"
        ? (context.resource.attributes["branch"] as string)
        : undefined;

  const tool =
    typeof env["tool"] === "string"
      ? env["tool"]
      : typeof context.resource.attributes?.["tool"] === "string"
        ? (context.resource.attributes["tool"] as string)
        : undefined;

  const timestampRaw = env["timestamp"];
  const timestamp =
    typeof timestampRaw === "string" || timestampRaw instanceof Date
      ? new Date(timestampRaw)
      : null;

  const validTimestamp = timestamp && !Number.isNaN(timestamp.valueOf()) ? timestamp : undefined;
  const day = validTimestamp ? DAY_LABELS[validTimestamp.getUTCDay()] : undefined;
  const time = validTimestamp
    ? `${pad2(validTimestamp.getUTCHours())}:${pad2(validTimestamp.getUTCMinutes())}`
    : undefined;
  const timeMinutes = validTimestamp
    ? validTimestamp.getUTCHours() * 60 + validTimestamp.getUTCMinutes()
    : undefined;

  return {
    ...(role !== undefined ? { role } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(tool !== undefined ? { tool } : {}),
    ...(day !== undefined ? { day } : {}),
    ...(time !== undefined ? { time } : {}),
    ...(timeMinutes !== undefined ? { timeMinutes } : {}),
  };
}

export function conditionsMatch(
  conditions: PolicyCondition[],
  context: EvaluationContext,
): boolean {
  const dimensions = deriveConditionalDimensions(context);
  return conditions.every((condition) => evaluateCondition(condition, context, dimensions));
}
