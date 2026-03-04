import { promises as fs } from "node:fs";
import path from "node:path";
import { type PolicyDocument, PolicyDocumentSchema, type PolicyRule } from "./policy-schema.js";
import { validatePolicyDocument } from "./policy-validator.js";

export type PolicyDocumentFormat = "json" | "yaml";

export interface PolicyDocumentLoadError {
  path: string;
  message: string;
}

export interface LoadedPolicyDocument {
  path: string;
  format: PolicyDocumentFormat;
  document?: PolicyDocument;
  errors: string[];
}

export interface PolicyRepositoryLoadResult {
  documents: LoadedPolicyDocument[];
  validDocuments: PolicyDocument[];
  errors: PolicyDocumentLoadError[];
}

export interface PolicyDiffEntry {
  id: string;
  type: "add" | "update" | "remove";
  before?: PolicyRule;
  after?: PolicyRule;
}

export interface PolicyDeploymentPlan {
  ok: boolean;
  dryRun: boolean;
  current: PolicyDocument;
  candidate?: PolicyDocument;
  next?: PolicyDocument;
  summary: {
    add: number;
    update: number;
    remove: number;
    unchanged: number;
  };
  changes: PolicyDiffEntry[];
  errors: string[];
}

export interface PolicyApplyResult {
  ok: boolean;
  dryRun: boolean;
  applied: boolean;
  document: PolicyDocument;
  summary: PolicyDeploymentPlan["summary"];
  changes: PolicyDiffEntry[];
  errors: string[];
}

const SUPPORTED_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);

const canonicalRuleJson = (rule: PolicyRule): string => {
  const normalized = PolicyDocumentSchema.shape.rules.element.parse(rule);
  return JSON.stringify(normalized);
};

const compareRuleIds = (a: string, b: string): number => a.localeCompare(b, "en");

const parseYamlScalar = (raw: string): string | number | boolean | null => {
  const value = raw.trim();
  if (value === "") {
    return "";
  }
  if (value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const parseSimpleYamlPolicy = (yamlText: string): unknown => {
  // Minimal parser covering simple key/value + array/object structures used in CI fixtures.
  // For complex YAML, callers should pre-parse and pass objects into validatePolicyDocument.
  const lines = yamlText.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: unknown }> = [{ indent: -1, value: root }];

  const ensureContainer = (parent: unknown, key: string, isArray: boolean): unknown => {
    if (!parent || typeof parent !== "object") {
      return isArray ? [] : {};
    }
    const record = parent as Record<string, unknown>;
    if (!(key in record)) {
      record[key] = isArray ? [] : {};
    }
    return record[key];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sourceLine = lines[lineIndex] ?? "";
    const line = sourceLine.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) {
        break;
      }
      stack.pop();
    }

    const parent = stack[stack.length - 1]?.value;
    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error(`Invalid YAML list placement near: ${trimmed}`);
      }
      const itemValue = trimmed.slice(2);
      if (itemValue.includes(":")) {
        const [k, ...rest] = itemValue.split(":");
        if (!k) {
          throw new Error(`Invalid YAML list item: ${trimmed}`);
        }
        const obj: Record<string, unknown> = {};
        obj[k.trim()] = parseYamlScalar(rest.join(":").trim());
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseYamlScalar(itemValue));
      }
      continue;
    }

    const [keyRaw, ...rest] = trimmed.split(":");
    if (!keyRaw || rest.length === 0) {
      throw new Error(`Invalid YAML line: ${trimmed}`);
    }

    const key = keyRaw.trim();
    const valueRaw = rest.join(":").trim();

    if (valueRaw === "") {
      const nextLine = lines[lineIndex + 1] ?? "";
      const nextTrim = nextLine.trim();
      const nextIsArray = nextTrim.startsWith("- ");

      if (Array.isArray(parent)) {
        const obj: Record<string, unknown> = {};
        parent.push(obj);
        const nested = ensureContainer(obj, key, nextIsArray);
        stack.push({ indent, value: nested });
      } else if (parent && typeof parent === "object") {
        const nested = ensureContainer(parent, key, nextIsArray);
        stack.push({ indent, value: nested });
      } else {
        throw new Error(`Invalid YAML object placement near: ${trimmed}`);
      }
      continue;
    }

    const parsedScalar = parseYamlScalar(valueRaw);
    if (Array.isArray(parent)) {
      const obj: Record<string, unknown> = {};
      obj[key] = parsedScalar;
      parent.push(obj);
      stack.push({ indent, value: obj });
    } else if (parent && typeof parent === "object") {
      (parent as Record<string, unknown>)[key] = parsedScalar;
    } else {
      throw new Error(`Invalid YAML line: ${trimmed}`);
    }
  }

  return root;
};

const readPolicyFile = async (filePath: string): Promise<LoadedPolicyDocument> => {
  const ext = path.extname(filePath).toLowerCase();
  const format: PolicyDocumentFormat = ext === ".json" ? "json" : "yaml";

  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed: unknown =
      format === "json" ? (JSON.parse(text) as unknown) : parseSimpleYamlPolicy(text);

    const result = validatePolicyDocument(parsed);
    return {
      path: filePath,
      format,
      ...(result.document ? { document: result.document } : {}),
      errors: result.errors,
    };
  } catch (error) {
    return {
      path: filePath,
      format,
      errors: [String(error)],
    };
  }
};

const collectPolicyFiles = async (repoPath: string): Promise<string[]> => {
  const stat = await fs.stat(repoPath);
  if (stat.isFile()) {
    const ext = path.extname(repoPath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext) ? [repoPath] : [];
  }

  const out: string[] = [];
  const queue: string[] = [repoPath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        out.push(fullPath);
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b, "en"));
  return out;
};

export const loadPolicyDocumentsFromPaths = async (
  repoPaths: string[],
): Promise<PolicyRepositoryLoadResult> => {
  const uniquePaths = [...new Set(repoPaths)].sort((a, b) => a.localeCompare(b, "en"));
  const files = (
    await Promise.all(uniquePaths.map(async (repoPath) => collectPolicyFiles(repoPath)))
  ).flat();

  const dedupedFiles = [...new Set(files)].sort((a, b) => a.localeCompare(b, "en"));
  const documents = await Promise.all(dedupedFiles.map(async (file) => readPolicyFile(file)));

  const errors: PolicyDocumentLoadError[] = [];
  const validDocuments: PolicyDocument[] = [];

  for (const loaded of documents) {
    if (loaded.errors.length > 0) {
      for (const message of loaded.errors) {
        errors.push({ path: loaded.path, message });
      }
      continue;
    }
    if (loaded.document) {
      validDocuments.push(loaded.document);
    }
  }

  return { documents, validDocuments, errors };
};

export const mergePolicyDocuments = (documents: PolicyDocument[]): PolicyDocument => {
  const byId = new Map<string, PolicyRule>();
  for (const doc of documents) {
    const sortedRules = [...doc.rules].sort((a, b) => compareRuleIds(a.id, b.id));
    for (const rule of sortedRules) {
      byId.set(rule.id, rule);
    }
  }

  return {
    version: documents[0]?.version ?? "v1",
    metadata: documents[0]?.metadata,
    rules: [...byId.values()].sort((a, b) => compareRuleIds(a.id, b.id)),
  };
};

const findDuplicateRuleIds = (document: PolicyDocument): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const rule of document.rules) {
    if (seen.has(rule.id)) {
      duplicates.add(rule.id);
    }
    seen.add(rule.id);
  }
  return [...duplicates].sort(compareRuleIds);
};

export const createPolicyDeploymentPlan = (input: {
  current: PolicyDocument;
  candidate: PolicyDocument;
  dryRun?: boolean;
}): PolicyDeploymentPlan => {
  const dryRun = input.dryRun ?? true;
  const errors: string[] = [];

  const currentValidation = validatePolicyDocument(input.current);
  const candidateValidation = validatePolicyDocument(input.candidate);
  if (!currentValidation.valid) {
    errors.push(...currentValidation.errors.map((error) => `current: ${error}`));
  }
  if (!candidateValidation.valid) {
    errors.push(...candidateValidation.errors.map((error) => `candidate: ${error}`));
  }

  const candidate = candidateValidation.document;
  const current = currentValidation.document;

  if (!candidate || !current) {
    return {
      ok: false,
      dryRun,
      current: input.current,
      summary: { add: 0, update: 0, remove: 0, unchanged: 0 },
      changes: [],
      errors,
    };
  }

  const duplicateIds = findDuplicateRuleIds(candidate);
  if (duplicateIds.length > 0) {
    return {
      ok: false,
      dryRun,
      current,
      candidate,
      summary: { add: 0, update: 0, remove: 0, unchanged: 0 },
      changes: [],
      errors: [...errors, `candidate: duplicate rule ids: ${duplicateIds.join(", ")}`],
    };
  }

  const currentById = new Map(current.rules.map((rule) => [rule.id, rule]));
  const candidateById = new Map(candidate.rules.map((rule) => [rule.id, rule]));
  const allIds = [...new Set([...currentById.keys(), ...candidateById.keys()])].sort(
    compareRuleIds,
  );

  const changes: PolicyDiffEntry[] = [];
  let unchanged = 0;

  for (const id of allIds) {
    const before = currentById.get(id);
    const after = candidateById.get(id);

    if (!before && after) {
      changes.push({ id, type: "add", after });
      continue;
    }
    if (before && !after) {
      changes.push({ id, type: "remove", before });
      continue;
    }
    if (before && after) {
      if (canonicalRuleJson(before) === canonicalRuleJson(after)) {
        unchanged += 1;
      } else {
        changes.push({ id, type: "update", before, after });
      }
    }
  }

  const next: PolicyDocument = {
    ...candidate,
    rules: [...candidate.rules].sort((a, b) => compareRuleIds(a.id, b.id)),
  };

  return {
    ok: errors.length === 0,
    dryRun,
    current,
    candidate,
    next,
    summary: {
      add: changes.filter((change) => change.type === "add").length,
      update: changes.filter((change) => change.type === "update").length,
      remove: changes.filter((change) => change.type === "remove").length,
      unchanged,
    },
    changes,
    errors,
  };
};

export const applyPolicyDeploymentPlan = (plan: PolicyDeploymentPlan): PolicyApplyResult => {
  if (!plan.ok || !plan.next) {
    return {
      ok: false,
      dryRun: plan.dryRun,
      applied: false,
      document: plan.current,
      summary: plan.summary,
      changes: plan.changes,
      errors: plan.errors.length > 0 ? plan.errors : ["Plan is invalid; apply skipped."],
    };
  }

  if (plan.dryRun) {
    return {
      ok: true,
      dryRun: true,
      applied: false,
      document: plan.current,
      summary: plan.summary,
      changes: plan.changes,
      errors: [],
    };
  }

  return {
    ok: true,
    dryRun: false,
    applied: true,
    document: plan.next,
    summary: plan.summary,
    changes: plan.changes,
    errors: [],
  };
};

export const formatPolicyPlanForCi = (plan: PolicyDeploymentPlan): string => {
  const lines = [
    `status=${plan.ok ? "ok" : "error"}`,
    `dryRun=${plan.dryRun}`,
    `add=${plan.summary.add}`,
    `update=${plan.summary.update}`,
    `remove=${plan.summary.remove}`,
    `unchanged=${plan.summary.unchanged}`,
  ];

  for (const change of plan.changes) {
    lines.push(`change=${change.type}:${change.id}`);
  }

  for (const error of plan.errors) {
    lines.push(`error=${error}`);
  }

  return lines.join("\n");
};
