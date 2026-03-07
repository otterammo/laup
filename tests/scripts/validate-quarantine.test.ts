import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("validate-quarantine script (CIG-008)", () => {
  let testDir: string;
  let scriptPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `validate-quarantine-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    scriptPath = join(process.cwd(), "scripts", "validate-quarantine.mjs");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should pass when no quarantine directories exist", () => {
    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("No quarantine directories found");
  });

  it("should fail when quarantine has no manifest", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    writeFileSync(join(quarantineDir, "flaky.test.ts"), "it('flaky test', () => {});");

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/Missing manifest file/);
  });

  it("should pass with valid quarantine manifest", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    const testFile = "flaky.test.ts";
    writeFileSync(join(quarantineDir, testFile), "it('flaky test', () => {});");

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: testFile,
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-07",
          targetFixDate: futureDate.toISOString().split("T")[0],
          reason: "Flaky test needs investigation",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("Valid");
    expect(result).toContain("All quarantine manifests valid");
  });

  it("should fail when test is overdue", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    const testFile = "overdue.test.ts";
    writeFileSync(join(quarantineDir, testFile), "it('overdue test', () => {});");

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: testFile,
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-01",
          targetFixDate: pastDate.toISOString().split("T")[0],
          reason: "Flaky test",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/OVERDUE/);
  });

  it("should warn when approaching deadline", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    const testFile = "soon.test.ts";
    writeFileSync(join(quarantineDir, testFile), "it('test', () => {});");

    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 2);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: testFile,
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-01",
          targetFixDate: soonDate.toISOString().split("T")[0],
          reason: "Flaky test",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    // Script should pass with warnings
    try {
      const result = execSync(`node ${scriptPath} 2>&1`, {
        cwd: testDir,
        encoding: "utf-8",
      });

      // Should still succeed
      expect(result).toContain("All quarantine manifests valid");
    } catch (_error) {
      // Should not throw
      throw new Error("Script should not fail on warnings");
    }
  });

  it("should fail when required fields are missing", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    const testFile = "incomplete.test.ts";
    writeFileSync(join(quarantineDir, testFile), "it('test', () => {});");

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: testFile,
          // Missing required fields
          reason: "Test",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/Missing required field/);
  });

  it("should fail when test file doesn't exist", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: "nonexistent.test.ts",
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-07",
          targetFixDate: futureDate.toISOString().split("T")[0],
          reason: "Test",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/Test file not found/);
  });

  it("should fail when manifest version is invalid", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    writeFileSync(join(quarantineDir, "test.test.ts"), "it('test', () => {});");

    const manifest = {
      version: "2.0", // Invalid version
      tests: [],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/Invalid manifest version/);
  });

  it("should detect orphaned test files", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    writeFileSync(join(quarantineDir, "orphaned.test.ts"), "it('orphaned', () => {});");
    writeFileSync(join(quarantineDir, "tracked.test.ts"), "it('tracked', () => {});");

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: "tracked.test.ts",
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-07",
          targetFixDate: futureDate.toISOString().split("T")[0],
          reason: "Test",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/Orphaned test files/);
  });

  it("should handle multiple quarantine directories", () => {
    const quarantine1 = join(testDir, "packages", "core", "__tests__", "quarantine");
    const quarantine2 = join(testDir, "packages", "cli", "__tests__", "quarantine");

    mkdirSync(quarantine1, { recursive: true });
    mkdirSync(quarantine2, { recursive: true });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    for (const dir of [quarantine1, quarantine2]) {
      writeFileSync(join(dir, "test.test.ts"), "it('test', () => {});");

      const manifest = {
        version: "1.0",
        tests: [
          {
            path: "test.test.ts",
            issueId: "#262",
            owner: "@otterammo",
            quarantinedAt: "2026-03-07",
            targetFixDate: futureDate.toISOString().split("T")[0],
            reason: "Flaky test",
          },
        ],
      };

      writeFileSync(join(dir, ".quarantine-manifest.json"), JSON.stringify(manifest, null, 2));
    }

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("2 quarantine directories");
    expect(result).toContain("2 quarantined tests");
  });

  it("should warn on long quarantine periods", () => {
    const quarantineDir = join(testDir, "__tests__", "quarantine");
    mkdirSync(quarantineDir, { recursive: true });

    const testFile = "longterm.test.ts";
    writeFileSync(join(quarantineDir, testFile), "it('test', () => {});");

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20); // Exceeds MAX_QUARANTINE_DAYS

    const manifest = {
      version: "1.0",
      tests: [
        {
          path: testFile,
          issueId: "#262",
          owner: "@otterammo",
          quarantinedAt: "2026-03-01",
          targetFixDate: futureDate.toISOString().split("T")[0],
          reason: "Long quarantine",
        },
      ],
    };

    writeFileSync(
      join(quarantineDir, ".quarantine-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    // Script should pass with warnings
    try {
      const result = execSync(`node ${scriptPath} 2>&1`, {
        cwd: testDir,
        encoding: "utf-8",
      });

      // Should still succeed
      expect(result).toContain("All quarantine manifests valid");
    } catch (_error) {
      // Should not throw
      throw new Error("Script should not fail on warnings");
    }
  });
});
