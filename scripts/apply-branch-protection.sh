#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-otterammo/laup}"
BRANCH="${2:-main}"
PAYLOAD_FILE=".github/branch-protection.main.json"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required" >&2
  exit 1
fi

if [[ ! -f "$PAYLOAD_FILE" ]]; then
  echo "error: payload file not found: $PAYLOAD_FILE" >&2
  exit 1
fi

echo "Applying branch protection to ${REPO}:${BRANCH} from ${PAYLOAD_FILE}"

# Build full branch protection payload from tracked minimal config.
# Fields not listed in the tracked file are pinned to safe defaults.
TMP_PAYLOAD="$(mktemp)"
node -e '
  const fs = require("node:fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const payload = {
    required_status_checks: cfg.required_status_checks,
    enforce_admins: false,
    required_pull_request_reviews: cfg.required_pull_request_reviews,
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: cfg.required_conversation_resolution ?? true,
    lock_branch: false,
    allow_fork_syncing: true
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(payload, null, 2));
' "$PAYLOAD_FILE" "$TMP_PAYLOAD"

gh api \
  -X PUT \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input "$TMP_PAYLOAD" >/dev/null

rm -f "$TMP_PAYLOAD"

echo "Branch protection updated for ${REPO}:${BRANCH}"