import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("validate-skip-only script (LGR-004)", () => {
  let testDir: string;
  let allowlistPath: string;
  let scriptPath: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `validate-skip-only-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    allowlistPath = join(testDir, ".skip-only-allowlist.json");
    scriptPath = join(process.cwd(), "scripts", "validate-skip-only.mjs");
  });

  afterEach(() => {
    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should pass when no skip/only markers are present", () => {
    const testFile = join(testDir, "__tests__", "clean.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    // Should not throw
    const result = execSync(`node ${scriptPath} ${testFile}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("No skip/only violations found");
  });

  it("should detect it.only markers", () => {
    const testFile = join(testDir, "__tests__", "has-only.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should detect it.skip markers", () => {
    const testFile = join(testDir, "__tests__", "has-skip.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.skip('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should detect test.only markers", () => {
    const testFile = join(testDir, "__tests__", "test-only.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { test, expect } from 'vitest';

test.only('should work', () => {
  expect(true).toBe(true);
});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should detect describe.only markers", () => {
    const testFile = join(testDir, "__tests__", "describe-only.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe.only('my test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should allow markers with valid allowlist entry", () => {
    const testFile = join(testDir, "__tests__", "allowed.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    // Create allowlist with future expiry date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/allowed.test.ts", // Use relative path
          issueId: "#250",
          expiryDate: futureDate.toISOString().split("T")[0],
          reason: "Temporary skip during refactoring",
        },
      ]),
    );

    // Should not throw
    const result = execSync(`node ${scriptPath} ${testFile}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("allowed via issue #250");
  });

  it("should reject markers with expired allowlist entry", () => {
    const testFile = join(testDir, "__tests__", "expired.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    // Create allowlist with past expiry date
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/expired.test.ts", // Use relative path
          issueId: "#250",
          expiryDate: pastDate.toISOString().split("T")[0],
          reason: "Temporary skip during refactoring",
        },
      ]),
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/EXPIRED/);
  });

  it("should reject allowlist entry without issueId", () => {
    const testFile = join(testDir, "__tests__", "no-issue.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    // Create allowlist without issueId
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/no-issue.test.ts", // Use relative path
          expiryDate: futureDate.toISOString().split("T")[0],
          reason: "Temporary skip during refactoring",
        },
      ]),
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/missing required fields/);
  });

  it("should reject allowlist entry without expiryDate", () => {
    const testFile = join(testDir, "__tests__", "no-expiry.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    // Create allowlist without expiryDate
    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/no-expiry.test.ts", // Use relative path
          issueId: "#250",
          reason: "Temporary skip during refactoring",
        },
      ]),
    );

    expect(() => {
      execSync(`node ${scriptPath} ${testFile}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/missing required fields/);
  });

  it("should only check test files", () => {
    const nonTestFile = join(testDir, "regular.ts");
    writeFileSync(
      nonTestFile,
      `
// This has it.only but isn't a test file
const it = { only: () => {} };
it.only('something');
    `,
    );

    // Should not throw - file is ignored
    const result = execSync(`node ${scriptPath} ${nonTestFile}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("No test files to check");
  });
});
