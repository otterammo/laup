#!/usr/bin/env bash
# Verify git hooks are properly installed and configured
# Used in CI and local verification

set -e

HUSKY_DIR=".husky"
HOOKS_TO_VERIFY=("pre-commit" "commit-msg" "pre-push")

echo "Verifying git hooks configuration..."

# Check that .husky directory exists
if [ ! -d "$HUSKY_DIR" ]; then
  echo "❌ Error: $HUSKY_DIR directory not found"
  exit 1
fi

# Check each required hook
for hook in "${HOOKS_TO_VERIFY[@]}"; do
  hook_path="$HUSKY_DIR/$hook"
  
  if [ ! -f "$hook_path" ]; then
    echo "❌ Error: Hook $hook_path does not exist"
    exit 1
  fi
  
  if [ ! -x "$hook_path" ]; then
    echo "❌ Error: Hook $hook_path is not executable"
    exit 1
  fi
  
  echo "✅ $hook_path exists and is executable"
done

# Verify pre-push hook contains verify:local
if ! grep -q "verify:local" "$HUSKY_DIR/pre-push"; then
  echo "❌ Error: pre-push hook does not call verify:local"
  exit 1
fi
echo "✅ pre-push hook includes verify:local command"

# Verify pre-commit hook contains lint-staged
if ! grep -q "lint-staged" "$HUSKY_DIR/pre-commit"; then
  echo "❌ Error: pre-commit hook does not call lint-staged"
  exit 1
fi
echo "✅ pre-commit hook includes lint-staged command"

echo ""
echo "✅ All git hooks verified successfully!"
