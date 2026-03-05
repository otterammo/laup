import { describe, expect, it } from "vitest";
import { parseCanonicalString } from "../parse.js";
import { mergeScopes } from "../scope.js";

describe("handoff template config (HAND-011)", () => {
  it("parses named handoff templates from YAML frontmatter", () => {
    const doc = parseCanonicalString(`---
version: "1.0"
scope: team
handoff:
  templates:
    code-review:
      version: "1.0.0"
      includedFields:
        - task
        - workingContext.openFiles
      routingPolicy: capability-match
      permissionScope:
        allow: ["read", "comment"]
        deny: ["delete"]
      defaultConstraints:
        - no-force-push
---

# Team config
`);

    expect(doc.frontmatter.handoff?.templates["code-review"]).toEqual({
      version: "1.0.0",
      includedFields: ["task", "workingContext.openFiles"],
      routingPolicy: "capability-match",
      permissionScope: {
        allow: ["read", "comment"],
        deny: ["delete"],
      },
      defaultConstraints: ["no-force-push"],
    });
  });

  it("merges templates by name across scopes, preferring higher precedence", () => {
    const merged = mergeScopes([
      {
        scope: "org",
        path: "org.md",
        document: parseCanonicalString(`---
version: "1.0"
scope: org
handoff:
  templates:
    triage:
      version: "1.0.0"
      includedFields: ["task"]
      routingPolicy: round-robin
      permissionScope:
        allow: ["read"]
        deny: []
      defaultConstraints: ["org-constraint"]
---

Org`),
      },
      {
        scope: "team",
        path: "team.md",
        document: parseCanonicalString(`---
version: "1.0"
scope: team
handoff:
  templates:
    triage:
      version: "1.1.0"
      includedFields: ["task", "conversationSummary"]
      routingPolicy: least-loaded
      permissionScope:
        allow: ["read", "write"]
        deny: []
      defaultConstraints: ["team-constraint"]
    incident:
      version: "1.0.0"
      includedFields: ["task", "constraints"]
      routingPolicy: direct
      permissionScope:
        allow: ["read"]
        deny: ["delete"]
      defaultConstraints: ["urgent"]
---

Team`),
      },
    ]);

    expect(merged.frontmatter.handoff?.templates["triage"]?.version).toBe("1.1.0");
    expect(merged.frontmatter.handoff?.templates["incident"]?.version).toBe("1.0.0");
  });
});
