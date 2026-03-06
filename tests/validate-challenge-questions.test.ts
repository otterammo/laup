/**
 * Tests for validate-challenge-questions.mjs script
 *
 * Requirements: QBASE-003
 */

import { exec } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execAsync = promisify(exec);

const TEST_DIR = join(process.cwd(), "tests", "fixtures", "challenge-questions");
const QUALITY_DIR = join(TEST_DIR, "quality");
const QUESTIONS_FILE = join(QUALITY_DIR, "challenge-questions.md");
const SCRIPT_PATH = join(process.cwd(), "scripts", "validate-challenge-questions.mjs");

describe("validate-challenge-questions", () => {
  beforeEach(async () => {
    await mkdir(QUALITY_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should pass validation when all questions are answered and approved", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question One

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** Yes, this is a test answer.
- **Approver:** @testuser
- **Approval Date:** 2026-03-06

---

### Q-002: Test Question Two

- **Question:** Another test question?
- **Context:** More testing
- **Answer:** Another test answer here.
- **Approver:** @reviewer
- **Approval Date:** 2026-03-05
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    const { stdout, stderr } = await execAsync(`node ${SCRIPT_PATH}`, {
      cwd: TEST_DIR,
    });

    expect(stdout).toContain("Found 2 challenge question(s)");
    expect(stdout).toContain("All challenge questions have been answered and approved");
    expect(stdout).toContain("Phase 3 progression is ALLOWED");
    expect(stderr).toBe("");
  });

  it("should fail validation when answer is missing", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:**
- **Approver:** @testuser
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Missing or pending answer");
      expect(err.stderr).toContain("Phase 3 progression is BLOCKED");
    }
  });

  it("should fail validation when answer contains (pending)", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** (pending)
- **Approver:** @testuser
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing or pending answer");
    }
  });

  it("should fail validation when approver is missing", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** Yes, this is answered.
- **Approver:**
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing or pending approver");
    }
  });

  it("should fail validation when approver contains (pending)", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** Yes, this is answered.
- **Approver:** (pending)
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing or pending approver");
    }
  });

  it("should fail validation when approval date is missing", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** Yes, this is answered.
- **Approver:** @testuser
- **Approval Date:**
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing or pending approval date");
    }
  });

  it("should fail validation when approval date contains (pending)", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** Yes, this is answered.
- **Approver:** @testuser
- **Approval Date:** (pending)
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing or pending approval date");
    }
  });

  it("should fail validation with multiple errors", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question One

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:**
- **Approver:**
- **Approval Date:**

---

### Q-002: Test Question Two

- **Question:** Another question?
- **Context:** Testing
- **Answer:** Has answer
- **Approver:** (pending)
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing or pending answer");
      expect(err.stderr).toContain("Q-001: Missing or pending approver");
      expect(err.stderr).toContain("Q-001: Missing or pending approval date");
      expect(err.stderr).toContain("Q-002: Missing or pending approver");
    }
  });

  it("should handle missing challenge questions file", async () => {
    // Don't create the file
    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("not found");
      expect(err.stderr).toContain("challenge-questions.md");
    }
  });

  it("should handle file with no challenge questions section", async () => {
    const content = `# Some Other Document

This document has no challenge questions section.
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("No challenge questions found");
    }
  });

  it("should handle multi-line answers correctly", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Question:** Is this a test?
- **Context:** Testing validation
- **Answer:** This is a multi-line answer that spans multiple lines in the document. It should still be captured and validated correctly.
- **Approver:** @testuser
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    const { stdout } = await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });

    expect(stdout).toContain("All challenge questions have been answered and approved");
  });

  it("should validate question field is present", async () => {
    const content = `# Challenge Questions

## Challenge Questions

### Q-001: Test Question

- **Context:** Testing validation
- **Answer:** Answer is here
- **Approver:** @testuser
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    try {
      await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });
      expect.fail("Should have thrown an error");
    } catch (error) {
      const err = error as { stdout: string; stderr: string };
      expect(err.stderr).toContain("Q-001: Missing question text");
    }
  });

  it("should pass with exactly formatted real-world example", async () => {
    const content = `# Challenge Questions for Hard-Gate Rollout

## Challenge Questions

### Q-001: Coverage Threshold Strategy

- **Question:** Should we enforce different coverage thresholds per package?
- **Context:** Current coverage varies widely.
- **Answer:** We will implement per-package thresholds based on current baseline.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

### Q-002: Test Flake Tolerance

- **Question:** What is the acceptable threshold for flaky tests?
- **Context:** Test flakiness indicates issues.
- **Answer:** Zero tolerance for new flaky tests.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06
`;

    await writeFile(QUESTIONS_FILE, content, "utf8");

    const { stdout } = await execAsync(`node ${SCRIPT_PATH}`, { cwd: TEST_DIR });

    expect(stdout).toContain("Found 2 challenge question(s)");
    expect(stdout).toContain("All challenge questions have been answered and approved");
  });
});
