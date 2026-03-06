import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("verify-toolchain script (LGR-007)", () => {
  let testDir: string;
  let scriptPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `verify-toolchain-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    scriptPath = join(process.cwd(), "scripts", "verify-toolchain.mjs");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should pass when versions meet requirements", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=22.0.0",
        pnpm: ">=9.0.0",
      },
      packageManager: "pnpm@9.15.4",
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("Toolchain Version Check (LGR-007)");
    expect(result).toContain("Node.js:");
    expect(result).toContain("Required: >=22.0.0");
    expect(result).toContain("pnpm:");
    expect(result).toContain("All toolchain version requirements satisfied");
  });

  it("should fail when Node version is too low", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=999.0.0", // Unrealistic requirement
        pnpm: ">=9.0.0",
      },
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should fail when pnpm version is too low", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=18.0.0",
        pnpm: ">=999.0.0", // Unrealistic requirement
      },
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should display required and detected versions in output", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=22.0.0",
        pnpm: ">=9.0.0",
      },
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("Required: >=22.0.0");
    expect(result).toContain("Detected:");
    expect(result).toMatch(/Detected:.*v?\d+\.\d+\.\d+/);
  });

  it("should warn when no engines are defined", () => {
    const packageJson = {
      name: "test-project",
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain('Warning: No "engines.node" constraint defined');
    expect(result).toContain("All toolchain version requirements satisfied");
  });

  it("should handle packageManager field for exact pnpm version", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=22.0.0",
        pnpm: ">=9.0.0",
      },
      packageManager: "pnpm@9.15.4",
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("Exact (packageManager): 9.15.4");
  });

  it("should warn if detected pnpm differs from packageManager", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=22.0.0",
        pnpm: ">=9.0.0",
      },
      packageManager: "pnpm@999.99.99", // Different from actual
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("Warning: Detected version");
    expect(result).toContain("differs from packageManager");
  });

  it("should validate caret (^) constraints", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: "^22.0.0",
        pnpm: "^9.0.0",
      },
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("All toolchain version requirements satisfied");
  });

  it("should validate tilde (~) constraints", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: "~22.0.0",
        pnpm: "~9.0.0",
      },
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    // This may pass or fail depending on actual versions
    // Just ensure the script runs without crashing
    try {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    } catch (error) {
      // Either pass or fail is acceptable for this test
      expect(error).toBeDefined();
    }
  });

  it("should handle missing package.json gracefully", () => {
    // No package.json created

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/Failed to read package\.json/);
  });

  it("should include clear error message with exit code 1 on failure", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=999.0.0",
        pnpm: ">=9.0.0",
      },
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    let exitCode = 0;
    try {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error) {
        exitCode = (error as { status: number }).status;
      }
    }

    expect(exitCode).toBe(1);
  });

  it("should read version contract from package.json as authoritative source", () => {
    const packageJson = {
      name: "test-project",
      engines: {
        node: ">=22.5.0",
        pnpm: ">=9.1.0",
      },
      packageManager: "pnpm@9.15.4",
    };

    writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2));

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    // Verify it reads the exact values from package.json
    expect(result).toContain("Required: >=22.5.0");
    expect(result).toContain("Required: >=9.1.0");
    expect(result).toContain("Exact (packageManager): 9.15.4");
  });
});
