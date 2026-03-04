#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/tutorial.sh [--auto] [--keep]

Interactive LAUP walkthrough:
  --auto, --yes  Run all steps without waiting for Enter.
  --keep         Keep the temporary tutorial workspace after exit.
  --help         Show this message.
EOF
}

AUTO=false
KEEP=false

while (($# > 0)); do
  case "$1" in
    --)
      ;;
    --auto|--yes|-y)
      AUTO=true
      ;;
    --keep)
      KEEP=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

supports_color() {
  [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]] && [[ "${TERM:-}" != "dumb" ]]
}

if supports_color; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_GRAY=$'\033[90m'
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_MAGENTA=$'\033[35m'
else
  C_RESET=""
  C_BOLD=""
  C_DIM=""
  C_GRAY=""
  C_CYAN=""
  C_GREEN=""
  C_YELLOW=""
  C_MAGENTA=""
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CLI_BIN="${REPO_ROOT}/packages/cli/dist/bin.js"
LAUP_CLI="node ${CLI_BIN}"
LAB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/laup-tutorial.XXXXXX")"
PROJECT_DIR="${LAB_DIR}/project"
HIER_DIR="${LAB_DIR}/hierarchy"
SCOPES_DIR="${LAB_DIR}/scopes"

cleanup() {
  if [[ "${KEEP}" == "true" ]]; then
    printf '\n%sTutorial workspace kept at:%s %s\n' "${C_GREEN}${C_BOLD}" "${C_RESET}" "${LAB_DIR}"
  else
    rm -rf "${LAB_DIR}"
  fi
}
trap cleanup EXIT

if [[ ! -f "${CLI_BIN}" ]]; then
  echo "CLI build output not found at ${CLI_BIN}" >&2
  echo "Run 'pnpm run build' from the repo root, then try again." >&2
  exit 1
fi

section() {
  printf '\n%s%s============================================================%s\n' "${C_BOLD}" "${C_CYAN}" "${C_RESET}"
  printf '%s%s%s\n' "${C_BOLD}${C_CYAN}" "$1" "${C_RESET}"
  printf '%s%s============================================================%s\n' "${C_BOLD}" "${C_CYAN}" "${C_RESET}"
}

pause_step() {
  if [[ "${AUTO}" == "true" ]]; then
    return
  fi

  printf '\n%sPress Enter to continue...%s' "${C_DIM}" "${C_RESET}"
  read -r _
}

run_cmd() {
  local cmd=("$@")

  printf '\n%s%s$%s' "${C_BOLD}" "${C_YELLOW}" "${C_RESET}"
  if [[ "${#cmd[@]}" -ge 2 && "${cmd[0]}" == "node" && "${cmd[1]}" == "${CLI_BIN}" ]]; then
    printf ' %s' '$LAUP_CLI'
    local i
    for ((i = 2; i < ${#cmd[@]}; i++)); do
      printf ' '
      print_display_arg "${cmd[i]}"
    done
  else
    local arg
    for arg in "${cmd[@]}"; do
      printf ' '
      print_display_arg "${arg}"
    done
  fi
  printf '\n'
  "${cmd[@]}" | colorize_command_output
}

show_file() {
  local file_path="$1"
  local lines="${2:-80}"
  printf '\n%s--- %s ---%s\n' "${C_BOLD}${C_MAGENTA}" "${file_path}" "${C_RESET}"
  sed -n "1,${lines}p" "${file_path}"
}

colorize_command_output() {
  local in_preview_file=false
  local current_tool=""
  local prev_line_blank=false
  local cursor_legacy_labeled=false
  local cursor_mdc_labeled=false
  local pending_cursor_mdc=false
  local pending_cursor_mdc_line=""
  local line=""

  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == "=== PREVIEW"* || "${line}" == "=== DIFF PREVIEW"* ]]; then
      if [[ "${pending_cursor_mdc}" == "true" ]]; then
        printf '%s%s%s\n' "${C_GRAY}" "${pending_cursor_mdc_line}" "${C_RESET}"
        pending_cursor_mdc=false
        pending_cursor_mdc_line=""
      fi
      in_preview_file=false
      current_tool=""
      prev_line_blank=false
      printf '%s%s%s\n' "${C_BOLD}${C_CYAN}" "${line}" "${C_RESET}"
      continue
    fi

    if [[ "${line}" == "── "* ]]; then
      if [[ "${pending_cursor_mdc}" == "true" ]]; then
        printf '%s%s%s\n' "${C_GRAY}" "${pending_cursor_mdc_line}" "${C_RESET}"
        pending_cursor_mdc=false
        pending_cursor_mdc_line=""
      fi
      in_preview_file=true
      prev_line_blank=false
      cursor_legacy_labeled=false
      cursor_mdc_labeled=false
      if [[ "${line}" =~ ^──[[:space:]]([^[:space:]:]+) ]]; then
        current_tool="${BASH_REMATCH[1]}"
      else
        current_tool=""
      fi
      printf '%s%s%s\n' "${C_BOLD}${C_CYAN}" "${line}" "${C_RESET}"
      continue
    fi

    if [[ "${in_preview_file}" == "true" ]]; then
      if [[ "${current_tool}" == "cursor" ]]; then
        if [[ "${pending_cursor_mdc}" == "true" ]]; then
          if [[ "${line}" == description:* ]]; then
            printf '%s%s[output: .cursor/rules/laup.mdc]%s\n' "${C_BOLD}" "${C_MAGENTA}" "${C_RESET}"
            cursor_mdc_labeled=true
          fi
          printf '%s%s%s\n' "${C_GRAY}" "${pending_cursor_mdc_line}" "${C_RESET}"
          pending_cursor_mdc=false
          pending_cursor_mdc_line=""
          prev_line_blank=false
        fi

        if [[ "${cursor_legacy_labeled}" == "false" ]] && [[ "${line}" == "<!-- laup:generated"* ]]; then
          printf '%s%s[output: .cursorrules]%s\n' "${C_BOLD}" "${C_MAGENTA}" "${C_RESET}"
          cursor_legacy_labeled=true
        elif [[ "${cursor_mdc_labeled}" == "false" ]] \
          && [[ "${cursor_legacy_labeled}" == "true" ]] \
          && [[ "${prev_line_blank}" == "true" ]] \
          && [[ "${line}" == "---" ]]; then
          pending_cursor_mdc=true
          pending_cursor_mdc_line="${line}"
          prev_line_blank=false
          continue
        fi
      fi

      if [[ -z "${line}" ]]; then
        prev_line_blank=true
        printf '\n'
        continue
      fi

      if [[ "${line}" == "<!--"* || "${line}" == "# laup:generated"* ]]; then
        prev_line_blank=false
        printf '%s%s%s\n' "${C_GREEN}" "${line}" "${C_RESET}"
        continue
      fi

      prev_line_blank=false
      printf '%s%s%s\n' "${C_GRAY}" "${line}" "${C_RESET}"
      continue
    fi

    prev_line_blank=false
    printf '%s\n' "${line}"
  done

  if [[ "${pending_cursor_mdc}" == "true" ]]; then
    printf '%s%s%s\n' "${C_GRAY}" "${pending_cursor_mdc_line}" "${C_RESET}"
  fi
}

print_display_arg() {
  local arg="$1"

  if path_alias "$arg" "PROJECT_DIR" "${PROJECT_DIR}"; then
    return
  fi
  if path_alias "$arg" "HIER_DIR" "${HIER_DIR}"; then
    return
  fi
  if path_alias "$arg" "SCOPES_DIR" "${SCOPES_DIR}"; then
    return
  fi
  if path_alias "$arg" "LAB_DIR" "${LAB_DIR}"; then
    return
  fi

  if [[ "${arg}" =~ ^[A-Za-z0-9_./,:=+-]+$ ]]; then
    printf '%s' "${arg}"
  else
    printf '%q' "${arg}"
  fi
}

path_alias() {
  local value="$1"
  local var_name="$2"
  local var_value="$3"

  if [[ "${value}" == "${var_value}" ]]; then
    printf '$%s' "${var_name}"
    return 0
  fi

  if [[ "${value}" == "${var_value}/"* ]]; then
    printf '$%s%s' "${var_name}" "${value#${var_value}}"
    return 0
  fi

  return 1
}

mkdir -p "${PROJECT_DIR}"

section "LAUP Interactive Tutorial"
cat <<EOF
This walkthrough runs in an isolated temporary workspace:
  LAB_DIR=${LAB_DIR}

Command aliases shown in examples:
  LAUP_CLI=${LAUP_CLI}
  PROJECT_DIR=${PROJECT_DIR}
  HIER_DIR=${HIER_DIR}
  SCOPES_DIR=${SCOPES_DIR}

It demonstrates:
  1) validate
  2) sync dry-run preview
  3) real sync output files
  4) dry-run diff
  5) category filtering
  6) include expansion
  7) hierarchy inheritance
  8) scope merging
  9) import to canonical format
EOF
pause_step

section "Step 1: Create a canonical instruction file"
cat > "${PROJECT_DIR}/laup.md" <<'EOF'
---
version: "1.0"
scope: project
metadata:
  name: "LAUP Tutorial"
  team: platform
tools:
  cursor:
    globs:
      - "src/**/*.ts"
    alwaysApply: true
  aider:
    model: claude-sonnet-4
    autoCommits: false
permissions:
  deniedTools:
    - "Bash(rm -rf*)"
---

# Tutorial Instructions

Keep changes focused and test before commit.
EOF
show_file "${PROJECT_DIR}/laup.md"
pause_step

section "Step 2: Validate the canonical file"
run_cmd node "${CLI_BIN}" validate --source "${PROJECT_DIR}/laup.md"
pause_step

section "Step 3: Preview sync output (dry-run)"
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup.md" \
  --tools claude-code,cursor,aider \
  --dry-run
pause_step

section "Step 4: Write tool-specific files"
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup.md" \
  --tools claude-code,cursor,aider
run_cmd find "${PROJECT_DIR}" -maxdepth 3 -type f | sort
pause_step

section "Step 5: Show diff preview after a change"
cat >> "${PROJECT_DIR}/laup.md" <<'EOF'

Prefer small, reversible commits.
EOF
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup.md" \
  --tools claude-code,cursor,aider \
  --dry-run \
  --diff
pause_step

section "Step 6: Filter adapters by category"
printf '%sIDE adapters:%s\n' "${C_BOLD}" "${C_RESET}"
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup.md" \
  --category ide \
  --dry-run
echo
printf '%sCLI adapters:%s\n' "${C_BOLD}" "${C_RESET}"
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup.md" \
  --category cli \
  --dry-run
pause_step

section "Step 7: Expand @include directives"
mkdir -p "${PROJECT_DIR}/snippets"
cat > "${PROJECT_DIR}/snippets/shared.md" <<'EOF'
Always explain risky commands before running them.
EOF

cat > "${PROJECT_DIR}/laup-with-include.md" <<'EOF'
---
version: "1.0"
scope: project
---

# Include Demo

Base instruction before include.

@include ./snippets/shared.md

Base instruction after include.
EOF

printf '%sWithout --expand-includes:%s\n' "${C_BOLD}" "${C_RESET}"
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup-with-include.md" \
  --tools claude-code \
  --dry-run
echo
printf '%sWith --expand-includes:%s\n' "${C_BOLD}" "${C_RESET}"
run_cmd node "${CLI_BIN}" sync \
  --source "${PROJECT_DIR}/laup-with-include.md" \
  --tools claude-code \
  --expand-includes \
  --dry-run
pause_step

section "Step 8: Inherit instructions from parent directories"
mkdir -p "${HIER_DIR}/org/team/service"

cat > "${HIER_DIR}/laup.md" <<'EOF'
---
version: "1.0"
scope: project
---

Organization-level convention.
EOF

cat > "${HIER_DIR}/org/laup.md" <<'EOF'
---
version: "1.0"
scope: project
---

Division-level convention.
EOF

cat > "${HIER_DIR}/org/team/service/laup.md" <<'EOF'
---
version: "1.0"
scope: project
---

Service-specific convention.
EOF

printf '%sWithout --inherit:%s\n' "${C_BOLD}" "${C_RESET}"
run_cmd node "${CLI_BIN}" sync \
  --source "${HIER_DIR}/org/team/service/laup.md" \
  --tools claude-code \
  --dry-run
echo
printf '%sWith --inherit:%s\n' "${C_BOLD}" "${C_RESET}"
run_cmd node "${CLI_BIN}" sync \
  --source "${HIER_DIR}/org/team/service/laup.md" \
  --tools claude-code \
  --inherit \
  --dry-run
pause_step

section "Step 9: Merge org/team/project scopes"
mkdir -p "${SCOPES_DIR}/teams" "${SCOPES_DIR}/project"

cat > "${SCOPES_DIR}/org.md" <<'EOF'
---
version: "1.0"
scope: org
---

Org scope rule.
EOF

cat > "${SCOPES_DIR}/teams/platform.md" <<'EOF'
---
version: "1.0"
scope: team
metadata:
  team: platform
---

Team scope rule.
EOF

cat > "${SCOPES_DIR}/project/laup.md" <<'EOF'
---
version: "1.0"
scope: project
metadata:
  team: platform
---

Project scope rule.
EOF

run_cmd node "${CLI_BIN}" sync \
  --source "${SCOPES_DIR}/project/laup.md" \
  --tools claude-code \
  --merge-scopes \
  --org-path "${SCOPES_DIR}/org.md" \
  --teams-dir "${SCOPES_DIR}/teams" \
  --dry-run
pause_step

section "Step 10: Import tool-specific file back to canonical format"
run_cmd node "${CLI_BIN}" import \
  --source "${PROJECT_DIR}/.cursorrules" \
  --output "${LAB_DIR}/imported-from-cursor.md"
show_file "${LAB_DIR}/imported-from-cursor.md"

section "Complete"
cat <<EOF
Tutorial finished.

Workspace:
  ${LAB_DIR}

Run again with:
  scripts/tutorial.sh

Useful flags:
  scripts/tutorial.sh --auto
  scripts/tutorial.sh --keep
EOF
