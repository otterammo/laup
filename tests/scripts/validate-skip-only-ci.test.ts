import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("validate-skip-only-ci script (CIG-008)", () => {
  let testDir: string;
  let allowlistPath: string;
  let scriptPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `validate-skip-only-ci-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    allowlistPath = join(testDir, ".skip-only-allowlist.json");
    scriptPath = join(process.cwd(), "scripts", "validate-skip-only-ci.mjs");
  });

  afterEach(() => {
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

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("No skip/only violations found");
  });

  it("should detect it.only markers across all files", () => {
    const testFile1 = join(testDir, "__tests__", "has-only-1.test.ts");
    const testFile2 = join(testDir, "__tests__", "has-only-2.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile1,
      `
import { describe, it, expect } from 'vitest';

describe('my test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    writeFileSync(
      testFile2,
      `
import { describe, it, expect } from 'vitest';

describe('another test', () => {
  it.only('should also work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should detect expired allowlist entries", () => {
    const testFile = join(testDir, "__tests__", "expired.test.ts");
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

    // Create expired allowlist
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/expired.test.ts",
          issueId: "#262",
          expiryDate: pastDate.toISOString().split("T")[0],
          reason: "Temporary skip",
        },
      ]),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/EXPIRED/);
  });

  it("should allow valid allowlist entries", () => {
    const testFile = join(testDir, "__tests__", "allowed.test.ts");
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

    // Create valid allowlist
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/allowed.test.ts",
          issueId: "#262",
          expiryDate: futureDate.toISOString().split("T")[0],
          reason: "Temporary skip during refactor",
        },
      ]),
    );

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("allowed via issue #262");
    expect(result).toContain("No skip/only violations found");
  });

  it("should detect all skip/only variants", () => {
    const testFile = join(testDir, "__tests__", "variants.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile,
      `
import { describe, it, test, expect } from 'vitest';

describe.only('suite1', () => {
  it('test1', () => {});
});

describe('suite2', () => {
  it.skip('test2', () => {});
  test.only('test3', () => {});
});

test.each.only([1, 2])('test4', () => {});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });

  it("should reject allowlist entry without required fields", () => {
    const testFile = join(testDir, "__tests__", "invalid.test.ts");
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

    // Missing issueId
    writeFileSync(
      allowlistPath,
      JSON.stringify([
        {
          path: "__tests__/invalid.test.ts",
          expiryDate: "2026-12-31",
          reason: "Test",
        },
      ]),
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow(/missing required fields/);
  });

  it("should provide summary with violation count", () => {
    const testFile1 = join(testDir, "__tests__", "test1.test.ts");
    const testFile2 = join(testDir, "__tests__", "test2.test.ts");
    mkdirSync(join(testDir, "__tests__"), { recursive: true });

    writeFileSync(
      testFile1,
      `
import { describe, it, expect } from 'vitest';

describe('test', () => {
  it('works', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    writeFileSync(
      testFile2,
      `
import { describe, it, expect } from 'vitest';

describe('test', () => {
  it('also works', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    const result = execSync(`node ${scriptPath}`, {
      cwd: testDir,
      encoding: "utf-8",
    });

    expect(result).toContain("Summary: 2 test files scanned");
  });

  it("should handle nested test directories", () => {
    const nestedTest = join(testDir, "packages", "core", "__tests__", "nested.test.ts");
    mkdirSync(join(testDir, "packages", "core", "__tests__"), {
      recursive: true,
    });

    writeFileSync(
      nestedTest,
      `
import { describe, it, expect } from 'vitest';

describe('nested test', () => {
  it.only('should work', () => {
    expect(true).toBe(true);
  });
});
    `,
    );

    expect(() => {
      execSync(`node ${scriptPath}`, {
        cwd: testDir,
        encoding: "utf-8",
      });
    }).toThrow();
  });
});
