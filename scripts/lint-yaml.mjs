import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const EXCLUDED_FILES = new Set(["pnpm-lock.yaml"]);

function getRepoFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

function normalizeFileList(args) {
  const files = args.length > 0 ? args : getRepoFiles();
  return files
    .map((file) => relative(process.cwd(), resolve(process.cwd(), file)).replaceAll("\\", "/"))
    .filter((file) => {
      const ext = extname(file).toLowerCase();
      return (ext === ".yml" || ext === ".yaml") && !EXCLUDED_FILES.has(file);
    });
}

function lineIssues(filePath, content) {
  const issues = [];
  const lines = content.split(/\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.includes("\t")) {
      issues.push({
        filePath,
        line: i + 1,
        col: line.indexOf("\t") + 1,
        message: "Tabs are not allowed in YAML files.",
      });
    }

    const trailingWhitespaceMatch = line.match(/[ \t]+$/);
    if (trailingWhitespaceMatch) {
      issues.push({
        filePath,
        line: i + 1,
        col: trailingWhitespaceMatch.index + 1,
        message: "Trailing whitespace is not allowed.",
      });
    }
  }

  return issues;
}

function parseIssues(filePath, content) {
  const issues = [];
  const doc = parseDocument(content, {
    uniqueKeys: true,
    prettyErrors: false,
  });

  for (const err of doc.errors) {
    const start = err.linePos?.[0];
    issues.push({
      filePath,
      line: start?.line ?? 1,
      col: start?.col ?? 1,
      message: err.message.split("\n")[0] ?? "Invalid YAML.",
    });
  }

  return issues;
}

function applySafeFixes(content) {
  let fixed = content
    .split(/\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  if (fixed.length > 0 && !fixed.endsWith("\n")) {
    fixed = `${fixed}\n`;
  }

  return fixed;
}

function formatIssue(issue) {
  return `${issue.filePath}:${issue.line}:${issue.col} ${issue.message}`;
}

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const fileArgs = args.filter((arg) => arg !== "--fix");

  const files = normalizeFileList(fileArgs);
  const issues = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");

    if (fix) {
      const fixed = applySafeFixes(content);
      if (fixed !== content) {
        writeFileSync(filePath, fixed, "utf8");
      }
    }

    const latest = readFileSync(filePath, "utf8");
    issues.push(...lineIssues(filePath, latest));
    issues.push(...parseIssues(filePath, latest));
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(formatIssue(issue));
    }
    process.exitCode = 1;
    return;
  }

  console.log(`lint-yaml: checked ${files.length} file(s)`);
}

main();
