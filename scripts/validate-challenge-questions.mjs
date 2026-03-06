#!/usr/bin/env node

/**
 * Validate that all challenge questions in quality/challenge-questions.md have been answered
 * and approved before allowing progression to Phase 3.
 *
 * Requirements (QBASE-003):
 * - All challenge questions must have documented answers
 * - All answers must have approver sign-off
 * - All answers must have approval dates
 *
 * Usage: node scripts/validate-challenge-questions.mjs
 *
 * Exit codes:
 *   0 - All challenge questions answered and approved
 *   1 - Unanswered or unapproved challenge questions found
 *   2 - Validation error (file not found, parse error, etc.)
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const QUESTIONS_PATH = join(process.cwd(), "quality", "challenge-questions.md");

/**
 * Parse challenge questions from the challenge-questions.md markdown
 * @param {string} content - The markdown content
 * @returns {Array<{id: string, question: string, answer: string | null, approver: string | null, approvalDate: string | null}>}
 */
function parseChallengeQuestions(content) {
  const questions = [];
  const lines = content.split("\n");
  let inChallengeSection = false;
  let currentQuestion = null;

  for (const line of lines) {
    // Detect the Challenge Questions section
    if (line.startsWith("## Challenge Questions")) {
      inChallengeSection = true;
      continue;
    }

    // Exit when we hit the next major section
    if (
      inChallengeSection &&
      line.startsWith("## ") &&
      !line.startsWith("## Challenge Questions")
    ) {
      break;
    }

    if (!inChallengeSection) {
      continue;
    }

    // Parse question ID and title
    const questionMatch = line.match(/^### (Q-\d+):/);
    if (questionMatch) {
      if (currentQuestion) {
        questions.push(currentQuestion);
      }
      currentQuestion = {
        id: questionMatch[1],
        question: null,
        answer: null,
        approver: null,
        approvalDate: null,
      };
      continue;
    }

    if (currentQuestion) {
      // Parse question text
      const questionTextMatch = line.match(/^- \*\*Question:\*\* (.+)$/);
      if (questionTextMatch) {
        currentQuestion.question = questionTextMatch[1];
        continue;
      }

      // Parse answer (may be multi-line)
      const answerMatch = line.match(/^- \*\*Answer:\*\* (.+)$/);
      if (answerMatch) {
        currentQuestion.answer = answerMatch[1];
        continue;
      }

      // Parse approver
      const approverMatch = line.match(/^- \*\*Approver:\*\* (@\w+)$/);
      if (approverMatch) {
        currentQuestion.approver = approverMatch[1];
        continue;
      }

      // Parse approval date
      const approvalDateMatch = line.match(/^- \*\*Approval Date:\*\* (\d{4}-\d{2}-\d{2})$/);
      if (approvalDateMatch) {
        currentQuestion.approvalDate = approvalDateMatch[1];
      }
    }
  }

  // Push the last question
  if (currentQuestion) {
    questions.push(currentQuestion);
  }

  return questions;
}

/**
 * Validate that all required fields are present
 * @param {Array<{id: string, question: string, answer: string | null, approver: string | null, approvalDate: string | null}>} questions
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateQuestions(questions) {
  const errors = [];

  if (questions.length === 0) {
    errors.push("No challenge questions found in quality/challenge-questions.md");
    return { valid: false, errors };
  }

  for (const q of questions) {
    if (!q.question) {
      errors.push(`${q.id}: Missing question text`);
    }

    if (!q.answer || q.answer.includes("(pending)") || q.answer.trim() === "") {
      errors.push(`${q.id}: Missing or pending answer`);
    }

    if (!q.approver || q.approver.includes("(pending)") || q.approver.trim() === "") {
      errors.push(`${q.id}: Missing or pending approver`);
    }

    if (!q.approvalDate || q.approvalDate.includes("(pending)") || q.approvalDate.trim() === "") {
      errors.push(`${q.id}: Missing or pending approval date`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function main() {
  try {
    const content = await readFile(QUESTIONS_PATH, "utf8");
    const questions = parseChallengeQuestions(content);

    console.log(
      `📋 Found ${questions.length} challenge question(s) in quality/challenge-questions.md`,
    );

    const { valid, errors } = validateQuestions(questions);

    if (valid) {
      console.log("✅ All challenge questions have been answered and approved");
      console.log("\n✓ Phase 3 progression is ALLOWED");
      return process.exit(0);
    }

    console.error("\n❌ Challenge question validation FAILED:\n");
    for (const error of errors) {
      console.error(`   - ${error}`);
    }
    console.error("\n⛔ Phase 3 progression is BLOCKED");
    console.error("   Update quality/challenge-questions.md to resolve the issues above.\n");

    return process.exit(1);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`❌ Error: ${QUESTIONS_PATH} not found`);
      console.error("   Create quality/challenge-questions.md to track challenge questions.");
    } else {
      console.error(`❌ Validation error: ${error.message}`);
    }
    return process.exit(2);
  }
}

main();
