/**
 * Tests for CIG-005 Security Scans validation
 * Ensures security scanning jobs are properly configured in CI
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CI_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/ci.yml");

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  steps: WorkflowStep[];
  "continue-on-error"?: boolean;
}

interface Workflow {
  name?: string;
  on: {
    push?: { branches: string[] };
    pull_request?: { branches: string[] };
  };
  jobs: Record<string, WorkflowJob>;
}

describe("CIG-005: Security Scans in CI", () => {
  let workflow: Workflow;

  it("should have ci.yml workflow file", () => {
    expect(fs.existsSync(CI_WORKFLOW)).toBe(true);
  });

  it("should parse workflow YAML successfully", () => {
    const content = fs.readFileSync(CI_WORKFLOW, "utf8");
    expect(() => {
      workflow = yaml.parse(content);
    }).not.toThrow();
    expect(workflow).toBeDefined();
  });

  describe("Acceptance Criteria 1: Dependency Vulnerability Scan", () => {
    it("should have security job", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      expect(workflow.jobs).toHaveProperty("security");
    });

    it("should run pnpm audit with high severity threshold", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const securityJob = workflow.jobs.security;

      const auditStep = securityJob.steps.find(
        (step) => step.name?.includes("vulnerability scan") || step.run?.includes("pnpm audit"),
      );

      expect(auditStep).toBeDefined();
      expect(auditStep?.run).toContain("pnpm audit");
      expect(auditStep?.run).toContain("--audit-level=high");
    });

    it("should hard-fail on vulnerabilities (no continue-on-error)", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const securityJob = workflow.jobs.security;

      const auditStep = securityJob.steps.find((step) => step.run?.includes("pnpm audit"));

      expect(auditStep).toBeDefined();
      expect(auditStep?.["continue-on-error"]).toBeUndefined();
    });

    it("should include CIG-005 label", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const securityJob = workflow.jobs.security;

      const auditStep = securityJob.steps.find((step) => step.run?.includes("pnpm audit"));

      expect(auditStep?.name).toContain("CIG-005");
    });
  });

  describe("Acceptance Criteria 2: Secret Scan", () => {
    it("should have secret_scan job", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      expect(workflow.jobs).toHaveProperty("secret_scan");
    });

    it("should use gitleaks-action", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const secretScanJob = workflow.jobs.secret_scan;

      const gitleaksStep = secretScanJob.steps.find((step) =>
        step.uses?.includes("gitleaks-action"),
      );

      expect(gitleaksStep).toBeDefined();
      expect(gitleaksStep?.uses).toContain("gitleaks/gitleaks-action");
    });

    it("should checkout with full history for PR diff scanning", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const secretScanJob = workflow.jobs.secret_scan;

      const checkoutStep = secretScanJob.steps.find((step) =>
        step.uses?.includes("actions/checkout"),
      );

      expect(checkoutStep).toBeDefined();
      expect(checkoutStep?.with?.["fetch-depth"]).toBe(0);
    });

    it("should hard-fail on detected secrets (no continue-on-error)", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const secretScanJob = workflow.jobs.secret_scan;

      const gitleaksStep = secretScanJob.steps.find((step) =>
        step.uses?.includes("gitleaks-action"),
      );

      expect(gitleaksStep).toBeDefined();
      expect(gitleaksStep?.["continue-on-error"]).toBeUndefined();
    });

    it("should include CIG-005 label", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const secretScanJob = workflow.jobs.secret_scan;

      const gitleaksStep = secretScanJob.steps.find((step) =>
        step.uses?.includes("gitleaks-action"),
      );

      expect(gitleaksStep?.name).toContain("CIG-005");
    });
  });

  describe("Acceptance Criteria 3: Workflow/Script Linting", () => {
    it("should have workflow_lint job", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      expect(workflow.jobs).toHaveProperty("workflow_lint");
    });

    it("should use actionlint", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const workflowLintJob = workflow.jobs.workflow_lint;

      const actionlintStep = workflowLintJob.steps.find((step) =>
        step.uses?.includes("actionlint"),
      );

      expect(actionlintStep).toBeDefined();
      expect(actionlintStep?.uses).toContain("rhysd/actionlint");
    });

    it("should hard-fail on lint errors (no continue-on-error)", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const workflowLintJob = workflow.jobs.workflow_lint;

      const actionlintStep = workflowLintJob.steps.find((step) =>
        step.uses?.includes("actionlint"),
      );

      expect(actionlintStep).toBeDefined();
      expect(actionlintStep?.["continue-on-error"]).toBeUndefined();
    });

    it("should include CIG-005 label", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);
      const workflowLintJob = workflow.jobs.workflow_lint;

      const actionlintStep = workflowLintJob.steps.find((step) =>
        step.uses?.includes("actionlint"),
      );

      expect(actionlintStep?.name).toContain("CIG-005");
    });
  });

  describe("CI Triggers", () => {
    it("should run on push to any branch", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);

      expect(workflow.on).toHaveProperty("push");
      expect(workflow.on.push?.branches).toContain("**");
    });

    it("should run on pull requests to main", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);

      expect(workflow.on).toHaveProperty("pull_request");
      expect(workflow.on.pull_request?.branches).toContain("main");
    });
  });

  describe("Documentation", () => {
    const DOC_PATH = path.join(REPO_ROOT, "docs/security-scans.md");

    it("should have security-scans.md documentation", () => {
      expect(fs.existsSync(DOC_PATH)).toBe(true);
    });

    it("should reference CIG-005 in documentation", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("CIG-005");
    });

    it("should reference DOC-620 in documentation", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("DOC-620");
    });

    it("should document all three scan types", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("Dependency Vulnerability Scan");
      expect(content).toContain("Secret Scan");
      expect(content).toContain("Workflow/Script Linting");
    });

    it("should document pnpm audit usage", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("pnpm audit");
      expect(content).toContain("--audit-level=high");
    });

    it("should document gitleaks usage", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("gitleaks");
    });

    it("should document actionlint usage", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("actionlint");
    });

    it("should reference issue #259", () => {
      const content = fs.readFileSync(DOC_PATH, "utf8");
      expect(content).toContain("#259");
    });
  });

  describe("Required Checks", () => {
    it("should have all security jobs configured to fail build", () => {
      const content = fs.readFileSync(CI_WORKFLOW, "utf8");
      workflow = yaml.parse(content);

      const securityJobs = ["security", "secret_scan", "workflow_lint"];

      for (const jobName of securityJobs) {
        const job = workflow.jobs[jobName];
        expect(job).toBeDefined();

        // Ensure no continue-on-error at job level
        expect(job?.["continue-on-error"]).toBeUndefined();

        // Ensure all steps don't have continue-on-error (except allowed cases)
        if (job) {
          for (const step of job.steps) {
            if (step.run || step.uses) {
              // Only coverage job should have continue-on-error
              if (!jobName.includes("coverage")) {
                expect(step["continue-on-error"]).toBeUndefined();
              }
            }
          }
        }
      }
    });
  });
});
