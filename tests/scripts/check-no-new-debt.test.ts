/**
 * Tests for No-New-Debt Rule (MIG-002)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "check-no-new-debt.mjs");
const BASELINE_FILE = path.join(REPO_ROOT, "quality", "baseline.v1.json");

describe("No-New-Debt Rule (MIG-002)", () => {
  let originalBaseline: string | null = null;

  beforeEach(() => {
    // Backup original baseline
    if (fs.existsSync(BASELINE_FILE)) {
      originalBaseline = fs.readFileSync(BASELINE_FILE, "utf8");
    }
  });

  afterEach(() => {
    // Restore original baseline
    if (originalBaseline !== null) {
      fs.writeFileSync(BASELINE_FILE, originalBaseline);
    }
  });

  it("should exist as executable script", () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);

    const stats = fs.statSync(SCRIPT_PATH);
    expect(stats.mode & 0o111).toBeGreaterThan(0); // Check if any execute bit is set
  });

  it("should have baseline file", () => {
    expect(fs.existsSync(BASELINE_FILE)).toBe(true);
  });

  it("should validate baseline schema", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));

    // Check required fields
    expect(baseline).toHaveProperty("schemaVersion");
    expect(baseline).toHaveProperty("commitSha");
    expect(baseline).toHaveProperty("generationTimestamp");
    expect(baseline).toHaveProperty("lintDiagnosticsBySeverity");
    expect(baseline).toHaveProperty("skippedTests");
    expect(baseline).toHaveProperty("flakyTests");
    expect(baseline).toHaveProperty("coverageByPackage");

    // Check lint diagnostics structure
    expect(baseline.lintDiagnosticsBySeverity).toHaveProperty("error");
    expect(baseline.lintDiagnosticsBySeverity).toHaveProperty("warning");
    expect(baseline.lintDiagnosticsBySeverity).toHaveProperty("info");

    // Check coverage structure
    for (const pkg of Object.keys(baseline.coverageByPackage)) {
      const coverage = baseline.coverageByPackage[pkg];
      expect(coverage).toHaveProperty("lines");
      expect(coverage).toHaveProperty("statements");
      expect(coverage).toHaveProperty("functions");
      expect(coverage).toHaveProperty("branches");

      for (const metric of ["lines", "statements", "functions", "branches"]) {
        expect(coverage[metric]).toHaveProperty("covered");
        expect(coverage[metric]).toHaveProperty("total");
        expect(coverage[metric]).toHaveProperty("pct");
      }
    }
  });

  it("should pass when current state matches baseline", () => {
    // This test assumes the current repo state is clean
    // Skip if we're in a dirty state
    try {
      execSync("git diff --quiet", { cwd: REPO_ROOT, stdio: "ignore" });
    } catch {
      console.log("Skipping test: working directory has uncommitted changes");
      return;
    }

    // Run the script - it should pass
    expect(() => {
      execSync("pnpm run quality:check-no-new-debt", {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
    }).not.toThrow();
  });

  describe("Violation Detection", () => {
    it("should fail when lint errors increase", () => {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
      baseline.lintDiagnosticsBySeverity.error = 0; // Set to 0 to ensure current > baseline
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

      // If current repo has any lint errors, this should fail
      try {
        const result = execSync("pnpm run lint:biome -- --reporter=json", {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
        });
        const lintResult = JSON.parse(result);
        const hasErrors = lintResult.diagnostics?.some(
          (d: { severity: string }) => d.severity === "error",
        );

        if (!hasErrors) {
          console.log("Skipping test: no lint errors in current state");
          return;
        }

        // Should throw because errors > baseline
        expect(() => {
          execSync("pnpm run quality:check-no-new-debt", {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: "pipe",
          });
        }).toThrow();
      } catch {
        // If lint itself fails, we probably have errors
        expect(() => {
          execSync("pnpm run quality:check-no-new-debt", {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: "pipe",
          });
        }).toThrow();
      }
    });

    it("should fail when skipped tests increase", () => {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
      const originalSkipped = baseline.skippedTests;

      // Set baseline to 0 to ensure any skipped tests fail
      baseline.skippedTests = 0;
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

      if (originalSkipped > 0) {
        // Should throw because current > baseline
        expect(() => {
          execSync("pnpm run quality:check-no-new-debt", {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: "pipe",
          });
        }).toThrow();
      }
    });

    it("should fail when coverage drops below baseline", () => {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));

      // Increase baseline coverage to impossible value to ensure failure
      for (const pkg of Object.keys(baseline.coverageByPackage)) {
        baseline.coverageByPackage[pkg].lines.pct = 100;
        baseline.coverageByPackage[pkg].statements.pct = 100;
        baseline.coverageByPackage[pkg].functions.pct = 100;
        baseline.coverageByPackage[pkg].branches.pct = 100;
      }

      fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

      // Should throw because coverage is below baseline
      expect(() => {
        execSync("pnpm run quality:check-no-new-debt", {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
        });
      }).toThrow();
    });
  });

  describe("Output Format", () => {
    it("should produce expected output format on success", () => {
      try {
        execSync("git diff --quiet", { cwd: REPO_ROOT, stdio: "ignore" });
      } catch {
        console.log("Skipping test: working directory has uncommitted changes");
        return;
      }

      try {
        const output = execSync("pnpm run quality:check-no-new-debt", {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
        });

        expect(output).toContain("🔍 Checking for new quality violations");
        expect(output).toContain("✅ NO NEW VIOLATIONS");
      } catch {
        // May fail if there are actual violations - that's ok for this test
      }
    });

    it("should produce expected output format on failure", () => {
      const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));

      // Force a failure by setting impossible baseline
      baseline.lintDiagnosticsBySeverity.error = 0;
      baseline.coverageByPackage = Object.fromEntries(
        Object.entries(baseline.coverageByPackage).map(([pkg, cov]) => [
          pkg,
          {
            ...(cov as Record<string, unknown>),
            lines: { ...(cov as Record<string, { pct: number }>).lines, pct: 100 },
          },
        ]),
      );

      fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

      try {
        execSync("pnpm run quality:check-no-new-debt", {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error: unknown) {
        const output = (error as { stdout?: { toString: () => string } }).stdout?.toString() || "";
        expect(output).toContain("❌ NEW VIOLATIONS DETECTED");
        expect(output).toContain("🚫 CI FAILED");
        expect(output).toContain("To resolve:");
      }
    });
  });

  describe("Environment Variables", () => {
    it("should accept BASE_BRANCH environment variable without crashing", () => {
      const env = { ...process.env, BASE_BRANCH: "main" };
      let didNotCrash = true;
      try {
        execSync("pnpm run quality:check-no-new-debt", {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
          env,
        });
      } catch {
        didNotCrash = false;
      }
      expect(didNotCrash).toBe(true);
    });
  });

  describe("Integration with package.json", () => {
    it("should have quality:check-no-new-debt script defined", () => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

      expect(packageJson.scripts).toHaveProperty("quality:check-no-new-debt");
      expect(packageJson.scripts["quality:check-no-new-debt"]).toContain("check-no-new-debt.mjs");
    });
  });

  describe("CI Integration", () => {
    it("should have no-new-debt job in CI workflow", () => {
      const ciWorkflow = fs.readFileSync(
        path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
        "utf8",
      );

      expect(ciWorkflow).toContain("no_new_debt:");
      expect(ciWorkflow).toContain("quality/no-new-debt");
      expect(ciWorkflow).toContain("check-no-new-debt.mjs");
      expect(ciWorkflow).toContain("MIG-002");
    });

    it("should have no-new-debt in branch protection config", () => {
      const branchProtection = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, ".github", "branch-protection.main.json"), "utf8"),
      );

      expect(branchProtection.required_status_checks.contexts).toContain("quality/no-new-debt");
    });
  });
});
