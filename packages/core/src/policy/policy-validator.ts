import { ZodError } from "zod";
import { type PolicyDocument, PolicyDocumentSchema } from "./policy-schema.js";

export interface ValidationResult {
  valid: boolean;
  document?: PolicyDocument;
  errors: string[];
}

export const validatePolicyDocument = (input: unknown): ValidationResult => {
  try {
    const document = PolicyDocumentSchema.parse(input);
    return { valid: true, document, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        valid: false,
        errors: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    return { valid: false, errors: [String(error)] };
  }
};

export const validatePolicyJson = (json: string): ValidationResult => {
  try {
    return validatePolicyDocument(JSON.parse(json) as unknown);
  } catch (error) {
    return { valid: false, errors: [`Invalid JSON: ${String(error)}`] };
  }
};

export const validatePolicyYaml = (yamlText: string): ValidationResult => {
  // Minimal YAML support for common "JSON-in-YAML" usage.
  // Full YAML parsing is intentionally left to callers that already parse YAML.
  try {
    const asJsonLike = yamlText.trim();
    if (asJsonLike.startsWith("{")) {
      return validatePolicyDocument(JSON.parse(asJsonLike) as unknown);
    }
    return {
      valid: false,
      errors: [
        "YAML parsing requires caller-provided YAML parser; pass parsed object to validatePolicyDocument().",
      ],
    };
  } catch (error) {
    return { valid: false, errors: [`Invalid YAML: ${String(error)}`] };
  }
};
