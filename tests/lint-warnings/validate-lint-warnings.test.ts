import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = join(process.cwd(), "scripts/validate-lint-warnings.mjs");
const ALLOWLIST_PATH = join(process.cwd(), ".lint-warnings-allowlist.json");
const BACKUP_PATH = `${ALLOWLIST_PATH}.backup`;

describe("validate-lint-warnings script (CIG-002)", () => {
  beforeEach(() => {
    // Backup existing allowlist
    try {
      const existing = readFileSync(ALLOWLIST_PATH, "utf-8");
      writeFileSync(BACKUP_PATH, existing);
    } catch {
      // No existing file, that's okay
    }
  });

  afterEach(() => {
    // Restore backup
    try {
      const backup = readFileSync(BACKUP_PATH, "utf-8");
      writeFileSync(ALLOWLIST_PATH, backup);
      unlinkSync(BACKUP_PATH);
    } catch {
      // No backup, write empty array
      writeFileSync(ALLOWLIST_PATH, "[]");
    }
  });

  it("should pass when allowlist is empty", () => {
    writeFileSync(ALLOWLIST_PATH, "[]");

    const result = execSync(`node ${SCRIPT_PATH}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });

    expect(result).toContain("Allowlist is empty");
    expect(result).toContain("no exceptions to validate");
  });

  it("should pass with valid exception entry", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const validEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "suspicious/noExplicitAny",
        justification: "This is a valid justification with more than 10 chars",
        approver: "@otterammo",
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(validEntry, null, 2));

    const result = execSync(`node ${SCRIPT_PATH}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });

    expect(result).toContain("exception(s) are valid");
  });

  it("should fail when entry is missing required fields", () => {
    const invalidEntry = [
      {
        file: "packages/core/src/test.ts",
        // Missing rule, justification, etc.
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow();
  });

  it("should fail when exception has expired", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);

    const expiredEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "suspicious/noExplicitAny",
        justification: "This exception has expired and should fail",
        approver: "@otterammo",
        approvalDate: "2026-01-01",
        expiryDate: pastDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(expiredEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/EXPIRED/);
  });

  it("should fail when file path is absolute", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const invalidEntry = [
      {
        file: "/absolute/path/to/file.ts",
        rule: "suspicious/noExplicitAny",
        justification: "This has an absolute path which is invalid",
        approver: "@otterammo",
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/relative path/);
  });

  it("should fail when rule format is invalid", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const invalidEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "noExplicitAny", // Missing category/
        justification: "This has invalid rule format",
        approver: "@otterammo",
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/category\/ruleName/);
  });

  it("should fail when approver doesn't start with @", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const invalidEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "suspicious/noExplicitAny",
        justification: "This has invalid approver format",
        approver: "otterammo", // Missing @
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/should start with/);
  });

  it("should fail when exception period exceeds 90 days", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 120); // 120 days > 90 days max

    const invalidEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "suspicious/noExplicitAny",
        justification: "This exception is too long",
        approver: "@otterammo",
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/exceeds 90 days/);
  });

  it("should fail when justification is too short", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const invalidEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "suspicious/noExplicitAny",
        justification: "Short", // Less than 10 characters
        approver: "@otterammo",
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "#300",
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/too short/);
  });

  it("should fail when tracking issue format is invalid", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const invalidEntry = [
      {
        file: "packages/core/src/test.ts",
        rule: "suspicious/noExplicitAny",
        justification: "This has invalid tracking issue format",
        approver: "@otterammo",
        approvalDate: "2026-03-06",
        expiryDate: futureDate.toISOString().split("T")[0],
        trackingIssue: "300", // Missing #
      },
    ];

    writeFileSync(ALLOWLIST_PATH, JSON.stringify(invalidEntry, null, 2));

    expect(() => {
      execSync(`node ${SCRIPT_PATH}`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    }).toThrow(/format '#123'/);
  });
});
