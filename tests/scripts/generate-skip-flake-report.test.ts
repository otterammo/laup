import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("generate-skip-flake-report script (CIG-008)", () => {
  let testDir: string;
  let scriptPath: string;
  let outputPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skip-flake-report-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    scriptPath = join(process.cwd(), "scripts", "generate-skip-flake-report.mjs");
    outputPath = join(testDir, "report.json");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should generate empty report when no tests exist", () => {
    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.totalSkipped).toBe(0);
    expect(report.summary.totalQuarantined).toBe(0);
    expect(report.skippedTests).toHaveLength(0);
    expect(report.quarantinedTests).toHaveLength(0);
    expect(report.violations).toHaveLength(0);
  });

  it("should detect skipped tests with valid allowlist", () => {
    const testFile = join(testDir, "__tests__", "skipped.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('test', () => {
  it.skip('skipped test', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const allowlist = [
      {
        path: "__tests__/skipped.test.ts",
        issueId: "#262",
        expiryDate: futureDate.toISOString().split("T")[0],
        reason: "Temporary skip",
      },
    ];

    writeFileSync(join(testDir, ".skip-only-allowlist.json"), JSON.stringify(allowlist, null, 2));

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.totalSkipped).toBe(1);
    expect(report.summary.skippedWithAllowlist).toBe(1);
    expect(report.summary.skippedWithoutAllowlist).toBe(0);
    expect(report.summary.expiredAllowlist).toBe(0);
    expect(report.skippedTests).toHaveLength(1);
    expect(report.skippedTests[0].status).toBe("valid");
    expect(report.violations).toHaveLength(0);
  });

  it("should detect skipped tests without allowlist as violations", () => {
    const testFile = join(testDir, "__tests__", "ungoverned.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('test', () => {
  it.skip('ungoverned skip', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.totalSkipped).toBe(1);
    expect(report.summary.skippedWithoutAllowlist).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].type).toBe("ungoverned-skip");
  });

  it("should detect expired allowlist entries as violations", () => {
    const testFile = join(testDir, "__tests__", "expired.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('test', () => {
  it.skip('expired skip', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const allowlist = [
      {
        path: "__tests__/expired.test.ts",
        issueId: "#262",
        expiryDate: pastDate.toISOString().split("T")[0],
        reason: "Expired skip",
      },
    ];

    writeFileSync(join(testDir, ".skip-only-allowlist.json"), JSON.stringify(allowlist, null, 2));

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.expiredAllowlist).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].type).toBe("expired-allowlist");
    expect(report.skippedTests[0].status).toBe("expired");
  });

  it("should track quarantined tests", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    writeFileSync(join(quarantineDir, "flaky.test.ts"), "it('flaky test', () => {});");

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: "flaky.test.ts",
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-07",
          targetFixDate: futureDate.toISOString().split("T")[0],
          reason: "Intermittent failures",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.totalQuarantined).toBe(1);
    expect(report.summary.quarantinedOverdue).toBe(0);
    expect(report.quarantinedTests).toHaveLength(1);
    expect(report.quarantinedTests[0].status).toBe("active");
    expect(report.quarantinedTests[0].owner).toBe("@otterammo");
  });

  it("should detect overdue quarantined tests as violations", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    writeFileSync(join(quarantineDir, "overdue.test.ts"), "it('overdue test', () => {});");

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: "overdue.test.ts",
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-01",
          targetFixDate: pastDate.toISOString().split("T")[0],
          reason: "Overdue test",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.quarantinedOverdue).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].type).toBe("overdue-quarantine");
    expect(report.quarantinedTests[0].status).toBe("overdue");
  });

  it("should track quarantined tests due soon", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    writeFileSync(join(quarantineDir, "soon.test.ts"), "it('test', () => {});");

    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 2);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: "soon.test.ts",
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-01",
          targetFixDate: soonDate.toISOString().split("T")[0],
          reason: "Due soon",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.summary.quarantinedDueSoon).toBe(1);
    expect(report.quarantinedTests[0].status).toBe("due-soon");
  });

  it("should calculate days until expiry/deadline", () => {
    const testFile = join(testDir, "__tests__", "test.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(testFile, `it.skip('test', () => {});`);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    const allowlist = [
      {
        path: "__tests__/test.test.ts",
        issueId: "#262",
        expiryDate: futureDate.toISOString().split("T")[0],
        reason: "Test",
      },
    ];

    writeFileSync(join(testDir, ".skip-only-allowlist.json"), JSON.stringify(allowlist, null, 2));

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.skippedTests[0].daysUntilExpiry).toBeGreaterThan(0);
    expect(report.skippedTests[0].daysUntilExpiry).toBeLessThanOrEqual(5);
  });

  it("should handle multiple skip/only markers in one file", () => {
    const testFile = join(testDir, "__tests__", "multiple.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('test', () => {
  it.skip('test1', () => {});
  it.skip('test2', () => {});
  it.only('test3', () => {});
});
    `,
    );

    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.skippedTests[0].violationCount).toBe(3);
  });

  it("should include timestamp in report", () => {
    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const report = JSON.parse(readFileSync(outputPath, "utf-8"));

    expect(report.timestamp).toBeDefined();
    expect(new Date(report.timestamp)).toBeInstanceOf(Date);
  });

  it("should create history directory and save snapshot", () => {
    execSync(`node ${scriptPath} --output ${outputPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    const historyDir = join(testDir, "quality", "skip-flake-history");
    const date = new Date().toISOString().split("T")[0];
    const historyFile = join(historyDir, `${date}.json`);

    expect(readFileSync(historyFile, "utf-8")).toBeTruthy();
  });
});
