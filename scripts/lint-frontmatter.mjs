import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const CANONICAL_KEYS = ["version", "scope", "metadata", "tools", "permissions"];

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
      return ext === ".md" || ext === ".mdc";
    });
}

function extractFrontmatter(content) {
  const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = normalized.split(/\n/);

  if ((lines[0] ?? "") !== "---") {
    return null;
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "---" || line === "...") {
      return {
        yaml: lines.slice(1, i).join("\n"),
        startLine: 2,
      };
    }
  }

  return {
    yaml: null,
    startLine: 2,
  };
}

function collectWhitespaceIssues(filePath, yamlText, startLine) {
  const issues = [];
  const lines = yamlText.split(/\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.includes("\t")) {
      issues.push({
        filePath,
        line: startLine + i,
        col: line.indexOf("\t") + 1,
        message: "Tabs are not allowed in frontmatter.",
      });
    }

    const trailingWhitespaceMatch = line.match(/[ \t]+$/);
    if (trailingWhitespaceMatch) {
      issues.push({
        filePath,
        line: startLine + i,
        col: trailingWhitespaceMatch.index + 1,
        message: "Trailing whitespace is not allowed in frontmatter.",
      });
    }
  }

  return issues;
}

function parseFrontmatter(filePath, yamlText, startLine) {
  const issues = [];
  const doc = parseDocument(yamlText, {
    uniqueKeys: true,
    prettyErrors: false,
  });

  for (const err of doc.errors) {
    const pos = err.linePos?.[0];
    issues.push({
      filePath,
      line: (pos?.line ?? 1) + startLine - 1,
      col: pos?.col ?? 1,
      message: err.message.split("\n")[0] ?? "Invalid frontmatter YAML.",
    });
  }

  const keys = [];
  if (doc.contents && doc.contents.type === "MAP") {
    for (const item of doc.contents.items) {
      const keyValue = item.key?.value;
      if (typeof keyValue === "string") {
        keys.push(keyValue);
      }
    }
  }

  return { issues, keys };
}

function canonicalOrderIssues(filePath, yamlText, startLine, keys) {
  const issues = [];
  if (!keys.some((name) => CANONICAL_KEYS.includes(name))) {
    return issues;
  }

  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  const seen = CANONICAL_KEYS.filter((key) => indexByKey.has(key));

  for (let i = 1; i < seen.length; i += 1) {
    const prev = seen[i - 1];
    const current = seen[i];
    const prevIndex = indexByKey.get(prev);
    const currentIndex = indexByKey.get(current);

    if (prevIndex !== undefined && currentIndex !== undefined && currentIndex < prevIndex) {
      const expectedOrder = CANONICAL_KEYS.join(", ");
      const lines = yamlText.split(/\n/);
      const keyLineIndex = lines.findIndex((line) => line.startsWith(`${current}:`));

      issues.push({
        filePath,
        line: keyLineIndex >= 0 ? startLine + keyLineIndex : startLine,
        col: 1,
        message: `Canonical frontmatter keys must follow order: ${expectedOrder}.`,
      });
    }
  }

  return issues;
}

function formatIssue(issue) {
  return `${issue.filePath}:${issue.line}:${issue.col} ${issue.message}`;
}

function main() {
  const files = normalizeFileList(process.argv.slice(2));
  const issues = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter) {
      continue;
    }

    if (frontmatter.yaml === null) {
      issues.push({
        filePath,
        line: 1,
        col: 1,
        message: "Frontmatter opening delimiter found without a closing delimiter.",
      });
      continue;
    }

    issues.push(...collectWhitespaceIssues(filePath, frontmatter.yaml, frontmatter.startLine));

    const parsed = parseFrontmatter(filePath, frontmatter.yaml, frontmatter.startLine);
    issues.push(...parsed.issues);

    if (parsed.issues.length === 0) {
      issues.push(
        ...canonicalOrderIssues(filePath, frontmatter.yaml, frontmatter.startLine, parsed.keys),
      );
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(formatIssue(issue));
    }
    process.exitCode = 1;
    return;
  }

  console.log(`lint-frontmatter: checked ${files.length} file(s)`);
}

main();
