# Security Scans in CI (CIG-005 / DOC-620)

## Overview

CIG-005 defines the requirements for security scanning in CI to detect vulnerabilities and leaked secrets before they reach production.

## Requirements

### 1. Dependency Vulnerability Scan

Dependency vulnerability scanning must run on:

- **Pull Requests:** All PRs to main
- **Main Branch:** All pushes to main

The scan must:

- Use `pnpm audit` with `--audit-level=high` threshold
- Fail the CI build if high or critical vulnerabilities are found
- Run on every CI execution (no caching of results)

### 2. Secret Scan

Secret scanning must run on:

- **Pull Requests:** Scan PR diffs for leaked secrets
- **Main Branch:** Scan commits for leaked secrets

The scan must:

- Use `gitleaks` to detect secrets in code
- Scan only the changed files/commits (not full history on every run)
- Fail the CI build if secrets are detected
- Support custom rules for repository-specific patterns

### 3. Workflow/Script Linting

GitHub Actions workflows and shell scripts must be linted:

- **Pull Requests:** Lint workflow files on changes
- **Main Branch:** Lint workflow files on changes

The linting must:

- Use `actionlint` for GitHub Actions workflow validation
- Check for common mistakes (typos, invalid syntax, security issues)
- Fail the CI build if errors are found

## Implementation

### Dependency Vulnerability Scan

Implemented in `.github/workflows/ci.yml`:

```yaml
security:
  name: quality/security
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v6
      with:
        node-version: "22"
        cache: "pnpm"
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Dependency vulnerability scan (CIG-005)
      run: pnpm audit --audit-level=high
```

This job:

1. Installs dependencies with pnpm
1. Runs `pnpm audit` to check for vulnerabilities
1. Fails if any high or critical severity vulnerabilities are found

### Secret Scan

Implemented in `.github/workflows/ci.yml`:

```yaml
secret_scan:
  name: quality/secret-scan
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
      with:
        fetch-depth: 0  # Fetch full history for PR diff scanning
    - name: Secret scan (CIG-005)
      uses: gitleaks/gitleaks-action@v2
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
```

This job:

1. Checks out the repository with full history
1. Runs gitleaks to scan for secrets
1. Automatically focuses on PR diffs when run in PR context
1. Fails if any secrets are detected

### Workflow Linting

Implemented in `.github/workflows/ci.yml`:

```yaml
workflow_lint:
  name: quality/workflow-lint
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - name: Lint GitHub Actions workflows (CIG-005)
      uses: rhysd/actionlint@v1.7.7
```

This job:

1. Checks out the repository
1. Runs actionlint on all workflow files
1. Fails if any errors are found

## Usage

### Local Development

#### Run Dependency Scan

```bash
pnpm audit --audit-level=high
```

#### Run Secret Scan

Install gitleaks:

```bash
# macOS
brew install gitleaks

# Linux
wget https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_linux_x64.tar.gz
tar -xzf gitleaks_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/
```

Scan for secrets:

```bash
# Scan uncommitted changes
gitleaks protect --staged

# Scan last commit
gitleaks detect --log-opts="-1"

# Scan entire history (slow, use sparingly)
gitleaks detect
```

#### Lint Workflows

Install actionlint:

```bash
# macOS
brew install actionlint

# Linux
wget https://github.com/rhysd/actionlint/releases/latest/download/actionlint_linux_amd64.tar.gz
tar -xzf actionlint_linux_amd64.tar.gz
sudo mv actionlint /usr/local/bin/
```

Lint workflows:

```bash
actionlint .github/workflows/*.yml
```

### CI

All three security scans run automatically on:

- Every push to any branch
- Every pull request to main

The CI build fails if any scan detects issues.

### Pre-commit Hooks

To catch issues before pushing, consider adding pre-commit hooks:

```bash
# In .husky/pre-commit or .git/hooks/pre-commit
#!/bin/sh

# Scan for secrets in staged changes
gitleaks protect --staged

# Run dependency audit (optional, can be slow)
# pnpm audit --audit-level=high
```

## Handling Findings

### Dependency Vulnerabilities

If `pnpm audit` finds vulnerabilities:

1. **Update Dependencies:**

   ```bash
   pnpm update <package-name>
   ```

1. **Review Breaking Changes:**
   - Check changelog for the updated package
   - Update code if API changed
   - Run tests to verify compatibility

1. **Override if Necessary:**
   - If update is not possible, document in `pnpm.overrides`
   - Create a tracking issue for future update
   - Add justification in PR description

### Detected Secrets

If gitleaks finds a secret:

1. **DO NOT** commit the secret
1. **Rotate the Credential:**
   - Immediately invalidate the leaked credential
   - Generate a new credential
   - Update configuration to use the new credential

1. **Remove from History:**

   ```bash
   # If not yet pushed
   git reset --soft HEAD~1
   git add -p  # Re-add without the secret
   git commit

   # If already pushed (more complex, requires force push)
   # Use BFG Repo-Cleaner or git-filter-repo
   ```

1. **Add to .gitignore:**
   - Ensure the file type is in `.gitignore`
   - Add patterns to prevent future leaks

### Workflow Lint Errors

If actionlint finds errors:

1. **Review the Error:**
   - Actionlint provides clear error messages
   - Check the line/column referenced

1. **Fix the Issue:**
   - Typos in action names
   - Invalid syntax
   - Missing required fields
   - Deprecated features

1. **Test Locally:**

   ```bash
   actionlint .github/workflows/ci.yml
   ```

## Exceptions

### Dependency Audit Exceptions

If a vulnerability cannot be fixed immediately:

1. Document in `quality/gaps.md`
1. Create a tracking issue
1. Add to PR description with justification
1. Consider using `pnpm.overrides` as temporary mitigation

### Secret Scan False Positives

If gitleaks reports a false positive:

1. **Verify it's actually a false positive** (not a real secret!)
1. Add to `.gitleaksignore` with justification:

   ```gitignore
   # Example API key pattern that's actually just a test fixture
   path/to/test/fixture.ts:12
   ```

1. Document the exception in PR description

### Workflow Lint Exceptions

Actionlint errors should always be fixed. If there's a compelling reason to ignore:

1. Add comment explaining why in the workflow file
1. Consider if the workflow can be refactored
1. Document in PR description

## Monitoring

Security scan results are tracked in:

- **CI Logs:** Each workflow run shows detailed output
- **Pull Request Checks:** Required status checks block merge
- **Quality Baseline:** Track vulnerability counts over time

## Rationale

### Why High Severity Threshold?

The `--audit-level=high` threshold balances:

- **Security:** Catches serious vulnerabilities
- **Pragmatism:** Avoids alert fatigue from low-severity findings
- **Maintainability:** Allows teams to address critical issues first

### Why Gitleaks?

Gitleaks is chosen because:

- **Open Source:** Free and community-maintained
- **Accurate:** Low false positive rate
- **Fast:** Efficient scanning of diffs
- **Configurable:** Supports custom patterns
- **Active:** Regularly updated with new patterns

### Why Actionlint?

Actionlint is chosen because:

- **Specialized:** Built specifically for GitHub Actions
- **Comprehensive:** Catches syntax, semantic, and security issues
- **Fast:** Written in Go, very performant
- **Maintained:** Actively developed and updated

## Integration with Other Gates

CIG-005 complements other quality gates:

- **CIG-001:** Explicit PR blocking gates (this is one of them)
- **CIG-002:** Lint strict mode (code quality)
- **CIG-003:** Coverage thresholds (test quality)
- **CIG-004:** Test hermeticity (test reliability)

All gates must pass for a PR to be merged.

## References

- **Issue #259:** CIG-005 implementation
- **DOC-620:** CI Merge Gates overview (wiki)
- [Gitleaks Documentation](https://github.com/gitleaks/gitleaks)
- [Actionlint Documentation](https://github.com/rhysd/actionlint)
- [pnpm audit Documentation](https://pnpm.io/cli/audit)
