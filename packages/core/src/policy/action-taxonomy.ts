import { z } from "zod";

export const ActionTaxonomyNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  description: z.string().optional(),
  inheritsToChildren: z.boolean().optional(),
});
export type ActionTaxonomyNode = z.infer<typeof ActionTaxonomyNodeSchema>;

export const ActionTaxonomySchema = z.object({
  version: z.string().optional(),
  nodes: z.array(ActionTaxonomyNodeSchema),
});
export type ActionTaxonomy = z.infer<typeof ActionTaxonomySchema>;

export interface ActionTaxonomyValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ActionTaxonomyIndex {
  readonly nodes: ReadonlyMap<string, ActionTaxonomyNode>;
  readonly descendantsById: ReadonlyMap<string, ReadonlySet<string>>;
}

const collectDescendants = (
  nodeId: string,
  childrenByParent: Map<string, string[]>,
  out: Set<string>,
): void => {
  const children = childrenByParent.get(nodeId) ?? [];
  for (const childId of children) {
    if (out.has(childId)) {
      continue;
    }
    out.add(childId);
    collectDescendants(childId, childrenByParent, out);
  }
};

export function validateActionTaxonomy(taxonomy: ActionTaxonomy): ActionTaxonomyValidationResult {
  const errors: string[] = [];
  const byId = new Map<string, ActionTaxonomyNode>();

  for (const node of taxonomy.nodes) {
    if (byId.has(node.id)) {
      errors.push(`Duplicate action taxonomy id: ${node.id}`);
      continue;
    }
    byId.set(node.id, node);
  }

  for (const node of taxonomy.nodes) {
    if (node.parentId && !byId.has(node.parentId)) {
      errors.push(`Unknown parentId '${node.parentId}' for action '${node.id}'`);
    }
    if (node.parentId === node.id) {
      errors.push(`Action '${node.id}' cannot be its own parent`);
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  const visit = (nodeId: string): void => {
    const currentState = state.get(nodeId);
    if (currentState === "visited") {
      return;
    }
    if (currentState === "visiting") {
      const idx = stack.indexOf(nodeId);
      const cyclePath = idx >= 0 ? [...stack.slice(idx), nodeId] : [...stack, nodeId];
      errors.push(`Action taxonomy cycle detected: ${cyclePath.join(" -> ")}`);
      return;
    }

    state.set(nodeId, "visiting");
    stack.push(nodeId);

    const node = byId.get(nodeId);
    if (node?.parentId && byId.has(node.parentId)) {
      visit(node.parentId);
    }

    stack.pop();
    state.set(nodeId, "visited");
  };

  for (const node of taxonomy.nodes) {
    visit(node.id);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function createActionTaxonomyIndex(taxonomy: ActionTaxonomy): ActionTaxonomyIndex {
  const parsed = ActionTaxonomySchema.parse(taxonomy);
  const validation = validateActionTaxonomy(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid action taxonomy: ${validation.errors.join("; ")}`);
  }

  const nodes = new Map<string, ActionTaxonomyNode>(
    parsed.nodes.map((node) => [node.id, node] as const),
  );

  const childrenByParent = new Map<string, string[]>();
  for (const node of parsed.nodes) {
    if (!node.parentId) {
      continue;
    }

    const list = childrenByParent.get(node.parentId);
    if (list) {
      list.push(node.id);
    } else {
      childrenByParent.set(node.parentId, [node.id]);
    }
  }

  const descendantsById = new Map<string, ReadonlySet<string>>();
  for (const node of parsed.nodes) {
    const descendants = new Set<string>();
    collectDescendants(node.id, childrenByParent, descendants);
    descendantsById.set(node.id, descendants);
  }

  return {
    nodes,
    descendantsById,
  };
}

export function resolveTaxonomyActionMatches(
  targetAction: string,
  patternAction: string,
  taxonomy?: ActionTaxonomyIndex,
): boolean {
  if (!taxonomy) {
    return false;
  }

  const actionNode = taxonomy.nodes.get(patternAction);
  if (!actionNode || !actionNode.inheritsToChildren) {
    return false;
  }

  const descendants = taxonomy.descendantsById.get(patternAction);
  return descendants?.has(targetAction) ?? false;
}
