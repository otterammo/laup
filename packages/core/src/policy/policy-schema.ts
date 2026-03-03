import { z } from "zod";

export const PolicyEffectSchema = z.enum(["allow", "deny"]);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

export const PolicyScopeSchema = z.enum(["global", "org", "team", "project", "user"]);
export type PolicyScope = z.infer<typeof PolicyScopeSchema>;

export const PolicyConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "in", "nin", "contains", "regex", "gt", "gte", "lt", "lte"]),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ]),
});
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  effect: PolicyEffectSchema,
  action: z.string().min(1),
  resource: z.string().min(1),
  scope: PolicyScopeSchema,
  scopeId: z.string().min(1),
  conditions: z.array(PolicyConditionSchema).default([]),
  description: z.string().optional(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyDocumentSchema = z.object({
  version: z.string().default("v1"),
  rules: z.array(PolicyRuleSchema).min(1),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      owner: z.string().optional(),
    })
    .optional(),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;
