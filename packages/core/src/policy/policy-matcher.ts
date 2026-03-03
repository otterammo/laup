import type { PolicyRule } from "./policy-schema.js";

export interface PolicyMatchContext {
  action: string;
  resource: string;
  scope: PolicyRule["scope"];
  scopeId: string;
  attributes?: Record<string, unknown>;
}

const globToRegex = (glob: string): RegExp => {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (!ch) {
      continue;
    }
    const next = glob[i + 1];
    if (ch === "*" && next === "*") {
      out += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += ".";
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
      continue;
    }
    out += ch;
  }
  out += "$";
  return new RegExp(out);
};

export const matchesGlob = (pattern: string, value: string): boolean => {
  if (pattern === "*") return true;
  return globToRegex(pattern).test(value);
};

const evaluateCondition = (
  fieldValue: unknown,
  operator: PolicyRule["conditions"][number]["operator"],
  expected: unknown,
): boolean => {
  switch (operator) {
    case "eq":
      return fieldValue === expected;
    case "neq":
      return fieldValue !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(fieldValue as never);
    case "nin":
      return Array.isArray(expected) && !expected.includes(fieldValue as never);
    case "contains":
      return Array.isArray(fieldValue)
        ? fieldValue.includes(expected as never)
        : typeof fieldValue === "string" && typeof expected === "string"
          ? fieldValue.includes(expected)
          : false;
    case "regex":
      return typeof fieldValue === "string" && typeof expected === "string"
        ? new RegExp(expected).test(fieldValue)
        : false;
    case "gt":
      return (
        typeof fieldValue === "number" && typeof expected === "number" && fieldValue > expected
      );
    case "gte":
      return (
        typeof fieldValue === "number" && typeof expected === "number" && fieldValue >= expected
      );
    case "lt":
      return (
        typeof fieldValue === "number" && typeof expected === "number" && fieldValue < expected
      );
    case "lte":
      return (
        typeof fieldValue === "number" && typeof expected === "number" && fieldValue <= expected
      );
    default:
      return false;
  }
};

export const matchesRule = (rule: PolicyRule, context: PolicyMatchContext): boolean => {
  if (!matchesGlob(rule.action, context.action)) return false;
  if (!matchesGlob(rule.resource, context.resource)) return false;
  if (rule.scope !== context.scope || rule.scopeId !== context.scopeId) return false;

  const attrs = context.attributes ?? {};
  return rule.conditions.every((condition) =>
    evaluateCondition(attrs[condition.field], condition.operator, condition.value),
  );
};
