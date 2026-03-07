/**
 * Tests for quality gap validation (QBASE-002, MIG-003)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const GAPS_FILE = path.join(REPO_ROOT, "quality", "gaps.md");

describe("Quality Gap Validation (QBASE-002)", () => {
  it("should have a gaps.md file", () => {
    expect(fs.existsSync(GAPS_FILE)).toBe(true);
  });

  it("should validate successfully with current gaps.md", () => {
    expect(() => {
      execSync("pnpm run quality:validate-gaps", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    }).not.toThrow();
  });

  describe("Gap Entry Structure", () => {
    it("should have all required fields in gaps.md", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");

      // Check for Open Gaps section
      expect(content).toContain("## Open Gaps");

      // Check for Closed Gaps section
      expect(content).toContain("## Closed Gaps");

      // Check gap entries have required fields
      const gapBlocks = content.match(/### GAP-\d+:.+?(?=###|##|$)/gs) || [];
      expect(gapBlocks.length).toBeGreaterThan(0);

      for (const block of gapBlocks) {
        expect(block).toContain("**Severity:**");
        expect(block).toContain("**Owner:**");
        expect(block).toContain("**Target Date:**");
        expect(block).toContain("**Status:**");
        expect(block).toContain("**Baseline Metric:**");
      }
    });

    it("should have valid severity values", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      const severityMatches = content.matchAll(/\*\*Severity:\*\*\s+(.+?)$/gm);

      const validSeverities = new Set(["Critical", "High", "Medium", "Low"]);

      for (const match of severityMatches) {
        const severity = match[1]?.trim();
        expect(validSeverities.has(severity || "")).toBe(true);
      }
    });

    it("should have valid status values", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      const statusMatches = content.matchAll(/\*\*Status:\*\*\s+(.+?)$/gm);

      const validStatuses = new Set(["Open", "In Progress", "Closed"]);

      for (const match of statusMatches) {
        const status = match[1]?.trim();
        expect(validStatuses.has(status || "")).toBe(true);
      }
    });

    it("should have ISO 8601 formatted target dates", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      const dateMatches = content.matchAll(/\*\*Target Date:\*\*\s+(.+?)$/gm);

      const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

      for (const match of dateMatches) {
        const dateStr = match[1]?.trim();
        expect(dateStr).toMatch(isoDateRegex);

        // Verify it's a valid date
        const date = new Date(dateStr || "");
        expect(date instanceof Date && !Number.isNaN(date.getTime())).toBe(true);
      }
    });

    it("should have GitHub usernames for owners", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      const ownerMatches = content.matchAll(/\*\*Owner:\*\*\s+(.+?)$/gm);

      for (const match of ownerMatches) {
        const owner = match[1]?.trim();
        expect(owner).toMatch(/^@[\w-]+$/);
      }
    });
  });

  describe("Backlog", () => {
    const backlogPath = path.join(REPO_ROOT, "quality", "backlog.md");

    it("should have a backlog.md file", () => {
      expect(fs.existsSync(backlogPath)).toBe(true);
    });

    it("should reference backlog from gaps.md", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      expect(content).toContain("backlog.md");
    });

    it("should have weekly review structure", () => {
      const content = fs.readFileSync(backlogPath, "utf8");
      expect(content).toContain("Week of:");
      expect(content).toContain("Current Sprint");
      expect(content).toContain("Next Sprint");
      expect(content).toContain("Backlog");
    });
  });

  describe("Coverage Targets", () => {
    it("should define coverage targets in gaps.md", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      expect(content).toContain("Coverage Targets");
      expect(content).toContain("80%");
    });

    it("should reference baseline.v1.json metrics", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      const baselinePath = path.join(REPO_ROOT, "quality", "baseline.v1.json");

      expect(fs.existsSync(baselinePath)).toBe(true);

      // Verify gaps reference actual packages from baseline
      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
      const packages = Object.keys(baseline.coverageByPackage || {});

      // At least one gap should reference a real package
      let foundReference = false;
      for (const pkg of packages) {
        if (content.includes(`\`${pkg}\``)) {
          foundReference = true;
          break;
        }
      }
      expect(foundReference).toBe(true);
    });
  });

  describe("Documentation", () => {
    const docPath = path.join(REPO_ROOT, "docs", "quality-gap-tracking.md");

    it("should have quality-gap-tracking.md documentation", () => {
      expect(fs.existsSync(docPath)).toBe(true);
    });

    it("should reference QBASE-002 in documentation", () => {
      const content = fs.readFileSync(docPath, "utf8");
      expect(content).toContain("QBASE-002");
    });

    it("should document required fields", () => {
      const content = fs.readFileSync(docPath, "utf8");
      expect(content).toContain("Owner");
      expect(content).toContain("Target Date");
      expect(content).toContain("Status");
    });

    it("should document validation command", () => {
      const content = fs.readFileSync(docPath, "utf8");
      expect(content).toContain("quality:validate-gaps");
    });
  });

  describe("Integration with Baseline", () => {
    it("should have gaps for packages below coverage targets", () => {
      const baselinePath = path.join(REPO_ROOT, "quality", "baseline.v1.json");
      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
      const gapsContent = fs.readFileSync(GAPS_FILE, "utf8");

      const TARGET_THRESHOLD = 80;

      // Check each package for coverage below threshold
      for (const [pkgName, metrics] of Object.entries(baseline.coverageByPackage || {})) {
        const pkgMetrics = metrics as {
          lines: { pct: number };
          branches: { pct: number };
        };

        const hasCoverageGap =
          pkgMetrics.lines.pct < TARGET_THRESHOLD || pkgMetrics.branches.pct < TARGET_THRESHOLD;

        if (hasCoverageGap) {
          // Should have a gap entry mentioning this package
          expect(gapsContent).toContain(pkgName);
        }
      }
    });
  });

  describe("MIG-003: Time-Bound Legacy Debt Budget", () => {
    it("should detect overdue gaps in validation output", () => {
      const output = execSync("pnpm run quality:validate-gaps", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

      // Should mention overdue status or no overdue gaps
      expect(output).toMatch(/overdue|All quality gaps are properly tracked/i);
    });

    it("should check target dates against current date", () => {
      const content = fs.readFileSync(GAPS_FILE, "utf8");
      const dateMatches = content.matchAll(/\*\*Target Date:\*\*\s+(.+?)$/gm);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const match of dateMatches) {
        const dateStr = match[1]?.trim();
        const targetDate = new Date(dateStr || "");

        // Verify date is valid and in a reasonable range
        expect(targetDate instanceof Date && !Number.isNaN(targetDate.getTime())).toBe(true);

        // Target dates should be within a year (reasonable range check)
        const oneYearFromNow = new Date(today);
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

        const threeMonthsAgo = new Date(today);
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        // Allow some historical dates but not too far in the past
        expect(targetDate.getTime()).toBeGreaterThan(threeMonthsAgo.getTime());
      }
    });

    it("should have quality:review script in package.json", () => {
      const packageJsonPath = path.join(REPO_ROOT, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

      expect(packageJson.scripts["quality:review"]).toBeDefined();
      expect(packageJson.scripts["quality:review"]).toContain("quality-review.mjs");
    });

    it("should generate weekly review report", () => {
      const output = execSync("pnpm run quality:review", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

      // Check report format
      expect(output).toContain("Weekly Quality Review Report");
      expect(output).toContain("Summary");
      expect(output).toContain("Total Open Gaps:");
      expect(output).toContain("Overdue:");
      expect(output).toContain("On Track:");
    });

    it("should save review report to .quality directory", () => {
      execSync("pnpm run quality:review", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

      const qualityDir = path.join(REPO_ROOT, ".quality");
      expect(fs.existsSync(qualityDir)).toBe(true);

      const today = new Date().toISOString().split("T")[0];
      const reportPath = path.join(qualityDir, `review-${today}.md`);
      expect(fs.existsSync(reportPath)).toBe(true);

      const reportContent = fs.readFileSync(reportPath, "utf8");
      expect(reportContent).toContain("# Weekly Quality Review Report");
      expect(reportContent).toContain("**Report Date:**");
    });

    it("should have MIG-003 documentation", () => {
      const docPath = path.join(REPO_ROOT, "docs", "time-bound-debt.md");
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, "utf8");
      expect(content).toContain("MIG-003");
      expect(content).toContain("Time-Bound Legacy Debt Budget");
      expect(content).toContain("owner");
      expect(content).toContain("severity");
      expect(content).toContain("target_date");
      expect(content).toContain("escalation");
    });

    it("should document weekly review process", () => {
      const docPath = path.join(REPO_ROOT, "docs", "time-bound-debt.md");
      const content = fs.readFileSync(docPath, "utf8");

      expect(content).toContain("Weekly Quality Review");
      expect(content).toContain("quality:review");
      expect(content).toContain("overdue");
    });

    it("should categorize gaps by severity in review report", () => {
      execSync("pnpm run quality:review", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

      const today = new Date().toISOString().split("T")[0];
      const reportPath = path.join(REPO_ROOT, ".quality", `review-${today}.md`);
      const reportContent = fs.readFileSync(reportPath, "utf8");

      // Report should have proper structure
      // If there are gaps, they should have severity
      // If all gaps are on track, report should say so
      expect(reportContent).toMatch(/\*\*Severity:\*\*|On Track|No overdue gaps/i);
    });

    it("should provide escalation recommendations for overdue gaps", () => {
      const output = execSync("pnpm run quality:review", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

      expect(output).toContain("Recommendations");
      expect(output).toContain("Next Steps");
    });
  });
});
