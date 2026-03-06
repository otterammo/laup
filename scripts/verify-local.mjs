#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const PACKAGE_DIR_TO_NAME = new Map([
  ["packages/core", "@laup/core"],
  ["packages/cli", "@laup/cli"],
  ["packages/config-hub", "@laup/config-hub"],
  ["packages/adapters/aider", "@laup/aider"],
  ["packages/adapters/claude-code", "@laup/claude-code"],
  ["packages/adapters/codex", "@laup/codex"],
  ["packages/adapters/copilot", "@laup/copilot"],
  ["packages/adapters/cursor", "@laup/cursor"],
  ["packages/adapters/opencode", "@laup/opencode"],
]);

const ROOT_WIDE_PREFIXES = ["scripts/", ".github/", "infra/"];
const ROOT_WIDE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vitest.config.ts",
  "biome.json",
]);

function run(command, args) {
  const label = [command, ...args].join(" ");
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(`\n✖ Failed: ${label} (exit ${code})`);
    process.exit(code);
  }
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBaseRef() {
  const fromEnv = process.env.VERIFY_BASE?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    git(["rev-parse", "--verify", "origin/main"]);
    return "origin/main";
  } catch {
    // ignore
  }

  try {
    git(["rev-parse", "--verify", "main"]);
    return "main";
  } catch {
    // ignore
  }

  return "HEAD~1";
}

function splitLines(text) {
  return text
    ? text
        .split("\n")
        .map((file) => file.trim())
        .filter(Boolean)
    : [];
}

function changedFiles(baseRef) {
  const mergeBase = git(["merge-base", "HEAD", baseRef]);

  const branchComparedToBase = splitLines(
    git(["diff", "--name-only", "--diff-filter=ACMR", `${mergeBase}...HEAD`]),
  );
  const staged = splitLines(git(["diff", "--name-only", "--diff-filter=ACMR", "--cached"]));
  const unstaged = splitLines(git(["diff", "--name-only", "--diff-filter=ACMR"]));
  const untracked = splitLines(git(["ls-files", "--others", "--exclude-standard"]));

  return [...new Set([...branchComparedToBase, ...staged, ...unstaged, ...untracked])].sort();
}

function collectChangedPackages(files) {
  const names = new Set();

  for (const file of files) {
    for (const [dir, packageName] of PACKAGE_DIR_TO_NAME.entries()) {
      if (file === dir || file.startsWith(`${dir}/`)) {
        names.add(packageName);
      }
    }
  }

  return [...names].sort();
}

function requiresRepoWideChecks(files) {
  return files.some(
    (file) =>
      ROOT_WIDE_FILES.has(file) || ROOT_WIDE_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function filesByExtensions(files, exts) {
  return files.filter((file) => exts.some((ext) => file.endsWith(ext)));
}

function main() {
  // LGR-007: Check toolchain versions before any other verification steps
  console.log("Verifying toolchain versions...\n");
  run("node", ["scripts/verify-toolchain.mjs"]);

  const baseRef = resolveBaseRef();
  const files = changedFiles(baseRef);

  console.log(`verify-local base: ${baseRef}`);

  if (files.length === 0) {
    console.log("No changed files detected. Nothing to verify.");
    return;
  }

  console.log(`Changed files (${files.length}):`);
  for (const file of files) {
    console.log(`  - ${file}`);
  }

  const markdownFiles = filesByExtensions(files, [".md", ".mdc"]);
  const yamlFiles = filesByExtensions(files, [".yml", ".yaml"]);
  const biomeFiles = filesByExtensions(files, [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
  ]);

  console.log("\n== Lint (changed files) ==");
  if (markdownFiles.length > 0) {
    run("pnpm", ["exec", "markdownlint-cli2", ...markdownFiles]);
    run("node", ["scripts/lint-frontmatter.mjs", ...markdownFiles]);
  } else {
    console.log("Skipping markdown/frontmatter lint (no changed .md/.mdc files).");
  }

  if (yamlFiles.length > 0) {
    run("node", ["scripts/lint-yaml.mjs", ...yamlFiles]);
  } else {
    console.log("Skipping YAML lint (no changed .yml/.yaml files).");
  }

  if (biomeFiles.length > 0) {
    run("pnpm", ["exec", "biome", "check", ...biomeFiles]);
  } else {
    console.log("Skipping Biome lint (no changed JS/TS/JSON files).");
  }

  const changedPackages = collectChangedPackages(files);
  const repoWide = requiresRepoWideChecks(files);

  console.log("\n== Typecheck + Tests (changed scope) ==");
  if (repoWide) {
    console.log("Detected root-level or shared infra changes; running full monorepo checks.");
    run("pnpm", ["run", "typecheck"]);
    run("pnpm", ["run", "test:run"]);
    return;
  }

  if (changedPackages.length === 0) {
    console.log("No package changes detected; skipping package typecheck/tests.");
    return;
  }

  console.log(`Changed packages: ${changedPackages.join(", ")}`);

  for (const packageName of changedPackages) {
    run("pnpm", ["--filter", packageName, "run", "typecheck"]);
  }

  for (const packageName of changedPackages) {
    run("pnpm", ["--filter", packageName, "run", "test:run"]);
  }
}

main();
