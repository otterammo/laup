#!/usr/bin/env node
/**
 * Weekly Quality Review Report (MIG-003)
 *
 * Generates escalation report for overdue quality gaps.
 * This script supports the Time-Bound Legacy Debt Budget requirement.
 *
 * Requirements:
 * - Report all gaps with target_date < today
 * - Group by severity for prioritization
 * - Show days overdue for each gap
 * - Provide actionable recommendations
 *
 * Exit codes:
 * - 0: Report generated successfully (even if gaps are overdue)
 * - 1: Error generating report
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GAPS_FILE = path.join(REPO_ROOT, "quality", "gaps.md");

/**
 * Parse gaps.md and extract gap entries
 */
function parseGapsFile(content) {
  const gaps = [];
  const sections = content.split(/^## /m).filter(Boolean);

  let inOpenSection = false;

  for (const section of sections) {
    const lines = section.split("\n");
    const sectionTitle = lines[0]?.trim().toLowerCase() || "";

    if (sectionTitle.includes("open gaps")) {
      inOpenSection = true;
    } else if (sectionTitle.includes("closed gaps")) {
      inOpenSection = false;
    } else {
      inOpenSection = false;
    }

    // Parse gap entries (marked by ### GAP-XXX:)
    const gapMatches = section.matchAll(/^### (GAP-\d+):\s*(.+?)$/gm);

    for (const match of gapMatches) {
      const gapId = match[1];
      const title = match[2];
      const startIndex = match.index || 0;

      // Extract the gap block until the next ### or end of section
      const blockEndMatch = section.slice(startIndex + match[0].length).match(/^###/m);
      const blockEnd = blockEndMatch
        ? startIndex + match[0].length + (blockEndMatch.index || 0)
        : section.length;
      const gapBlock = section.slice(startIndex, blockEnd);

      if (inOpenSection) {
        const gap = parseGapBlock(gapId, title, gapBlock);
        gaps.push(gap);
      }
    }
  }

  return gaps;
}

/**
 * Parse a single gap block
 */
function parseGapBlock(gapId, title, block) {
  return {
    id: gapId,
    title,
    severity: extractField(block, "Severity"),
    owner: extractField(block, "Owner"),
    targetDate: extractField(block, "Target Date"),
    status: extractField(block, "Status"),
    baselineMetric: extractField(block, "Baseline Metric"),
    description: extractDescription(block),
    actionItems: extractActionItems(block),
  };
}

/**
 * Extract a field value from the gap block
 */
function extractField(block, fieldName) {
  const regex = new RegExp(`^\\*\\*${fieldName}:\\*\\*\\s*(.+?)$`, "m");
  const match = block.match(regex);
  return match?.[1]?.trim() || null;
}

/**
 * Extract description from gap block
 */
function extractDescription(block) {
  const match = block.match(/\*\*Description:\*\*\s*\n(.+?)(?=\n\*\*|$)/s);
  return match?.[1]?.trim() || null;
}

/**
 * Extract action items from gap block
 */
function extractActionItems(block) {
  const match = block.match(/\*\*Action Items:\*\*\s*\n((?:- \[[ x]\].+?\n?)+)/s);
  if (!match) return [];

  const itemsText = match[1];
  const items = itemsText.match(/- \[[ x]\] (.+)/g) || [];
  return items.map((item) => {
    const checked = item.includes("[x]");
    const text = item.replace(/- \[[ x]\] /, "");
    return { text, completed: checked };
  });
}

/**
 * Validate ISO 8601 date format (YYYY-MM-DD)
 */
function isValidISODate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    return false;
  }

  const date = new Date(dateString);
  return date instanceof Date && !Number.isNaN(date.getTime());
}

/**
 * Check for overdue gaps and categorize by severity
 */
function analyzeOverdueGaps(gaps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueGaps = [];
  const upcomingGaps = []; // Due within 7 days
  const onTrackGaps = [];

  for (const gap of gaps) {
    if (gap.status === "Closed") {
      continue;
    }

    if (!gap.targetDate || !isValidISODate(gap.targetDate)) {
      continue;
    }

    const targetDate = new Date(gap.targetDate);
    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      const daysOverdue = Math.abs(diffDays);
      overdueGaps.push({ ...gap, daysOverdue });
    } else if (diffDays <= 7) {
      upcomingGaps.push({ ...gap, daysUntilDue: diffDays });
    } else {
      onTrackGaps.push({ ...gap, daysUntilDue: diffDays });
    }
  }

  // Sort by severity and days overdue
  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  overdueGaps.sort((a, b) => {
    const severityDiff = (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
    if (severityDiff !== 0) return severityDiff;
    return b.daysOverdue - a.daysOverdue;
  });

  upcomingGaps.sort((a, b) => {
    const severityDiff = (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
    if (severityDiff !== 0) return severityDiff;
    return a.daysUntilDue - b.daysUntilDue;
  });

  return { overdueGaps, upcomingGaps, onTrackGaps };
}

/**
 * Generate markdown report
 */
function generateReport(analysis, gaps) {
  const { overdueGaps, upcomingGaps, onTrackGaps } = analysis;
  const reportDate = new Date().toISOString().split("T")[0];

  let report = `# Weekly Quality Review Report\n\n`;
  report += `**Report Date:** ${reportDate}\n\n`;
  report += `## Summary\n\n`;
  report += `- **Total Open Gaps:** ${gaps.length}\n`;
  report += `- **Overdue:** ${overdueGaps.length} 🔴\n`;
  report += `- **Due This Week:** ${upcomingGaps.length} ⚠️\n`;
  report += `- **On Track:** ${onTrackGaps.length} ✅\n\n`;

  // Overdue gaps section (MIG-003 escalation)
  if (overdueGaps.length > 0) {
    report += `## 🚨 OVERDUE GAPS - ESCALATION REQUIRED (MIG-003)\n\n`;
    report += `These gaps have passed their target date and require immediate attention.\n\n`;

    for (const gap of overdueGaps) {
      report += `### ${gap.id}: ${gap.title}\n\n`;
      report += `- **Severity:** ${gap.severity} 🔴\n`;
      report += `- **Owner:** ${gap.owner}\n`;
      report += `- **Target Date:** ${gap.targetDate}\n`;
      report += `- **Days Overdue:** ${gap.daysOverdue}\n`;
      report += `- **Status:** ${gap.status}\n\n`;

      if (gap.description) {
        report += `**Description:**\n${gap.description}\n\n`;
      }

      if (gap.actionItems && gap.actionItems.length > 0) {
        report += `**Progress:**\n`;
        const completed = gap.actionItems.filter((item) => item.completed).length;
        const total = gap.actionItems.length;
        report += `- ${completed}/${total} action items completed\n\n`;
      }

      report += `**Required Actions:**\n`;
      report += `- [ ] Review with ${gap.owner} for status update\n`;
      report += `- [ ] Extend target date with justification, OR\n`;
      report += `- [ ] Close gap if resolved, OR\n`;
      report += `- [ ] Escalate to stakeholders if blocked\n\n`;
      report += `---\n\n`;
    }
  }

  // Upcoming gaps
  if (upcomingGaps.length > 0) {
    report += `## ⚠️ Due This Week\n\n`;
    report += `These gaps are due within the next 7 days.\n\n`;

    for (const gap of upcomingGaps) {
      report += `### ${gap.id}: ${gap.title}\n\n`;
      report += `- **Severity:** ${gap.severity}\n`;
      report += `- **Owner:** ${gap.owner}\n`;
      report += `- **Target Date:** ${gap.targetDate}\n`;
      report += `- **Days Until Due:** ${gap.daysUntilDue}\n\n`;

      if (gap.actionItems && gap.actionItems.length > 0) {
        const completed = gap.actionItems.filter((item) => item.completed).length;
        const total = gap.actionItems.length;
        report += `**Progress:** ${completed}/${total} action items completed\n\n`;
      }

      report += `---\n\n`;
    }
  }

  // On-track gaps summary
  if (onTrackGaps.length > 0) {
    report += `## ✅ On Track\n\n`;
    report += `${onTrackGaps.length} gaps are on track with target dates more than 7 days away.\n\n`;
  }

  // Recommendations
  report += `## Recommendations\n\n`;

  if (overdueGaps.length > 0) {
    const criticalOverdue = overdueGaps.filter((g) => g.severity === "Critical").length;
    const highOverdue = overdueGaps.filter((g) => g.severity === "High").length;

    if (criticalOverdue > 0) {
      report += `- 🚨 **URGENT:** ${criticalOverdue} Critical gap(s) overdue - immediate escalation required\n`;
    }
    if (highOverdue > 0) {
      report += `- ⚠️ **HIGH PRIORITY:** ${highOverdue} High severity gap(s) overdue\n`;
    }

    report += `- Review each overdue gap in the weekly quality meeting\n`;
    report += `- Update target dates with clear justification if extensions are needed\n`;
    report += `- Close gaps that have been resolved but not yet marked as closed\n`;
    report += `- Escalate blocked gaps to appropriate stakeholders\n\n`;
  } else {
    report += `- ✅ No overdue gaps - excellent progress!\n\n`;
  }

  if (upcomingGaps.length > 0) {
    report += `- Focus efforts on ${upcomingGaps.length} gap(s) due this week\n`;
    report += `- Ensure owners are on track to meet target dates\n\n`;
  }

  report += `## Next Steps\n\n`;
  report += `1. Review this report in the weekly quality meeting (Mondays at 9:00 AM)\n`;
  report += `2. Update [quality/gaps.md](../quality/gaps.md) with any status changes\n`;
  report += `3. Update [quality/backlog.md](../quality/backlog.md) with sprint priorities\n`;
  report += `4. Re-run this report next week: \`pnpm run quality:review\`\n\n`;

  return report;
}

/**
 * Main function
 */
function main() {
  console.log("📊 Generating Weekly Quality Review Report...\n");

  // Check if gaps file exists
  if (!fs.existsSync(GAPS_FILE)) {
    console.error(`❌ Error: ${GAPS_FILE} not found`);
    process.exit(1);
  }

  const content = fs.readFileSync(GAPS_FILE, "utf8");
  const gaps = parseGapsFile(content);

  console.log(`Found ${gaps.length} open gap entries`);

  // Analyze gaps
  const analysis = analyzeOverdueGaps(gaps);
  const { overdueGaps } = analysis;

  // Generate report
  const report = generateReport(analysis, gaps);

  // Write report to file
  const reportDir = path.join(REPO_ROOT, ".quality");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportDate = new Date().toISOString().split("T")[0];
  const reportPath = path.join(reportDir, `review-${reportDate}.md`);
  fs.writeFileSync(reportPath, report, "utf8");

  // Output to console
  console.log(`\n${report}`);

  console.log(`\n📝 Report saved to: ${path.relative(REPO_ROOT, reportPath)}\n`);

  // Summary
  if (overdueGaps.length > 0) {
    console.log(`⚠️  ${overdueGaps.length} OVERDUE GAP(S) - ESCALATION REQUIRED`);
    console.log(`   Review in weekly quality meeting\n`);
  } else {
    console.log(`✅ No overdue gaps - all on track!\n`);
  }

  process.exit(0);
}

main();
