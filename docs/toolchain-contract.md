# Reproducible Toolchain Contract (LGR-007)

**Status:** ✅ Implemented
**Issue:** #253
**Milestone:** DOC-610 Local Guardrails (LGR)

## Overview

The Reproducible Toolchain Contract ensures that all developers and CI environments use compatible versions of Node.js and pnpm. This prevents "works on my machine" issues caused by toolchain version mismatches and ensures reproducible builds across all environments.

## Policy

As defined in LGR-007:

- Node.js and pnpm versions must be declared in `package.json` (the authoritative source)
- Version requirements are checked **before** any other verification steps
- Verification fails fast with clear error messages showing required vs detected versions
- All team members and CI must use toolchain versions that satisfy the constraints

## Implementation

### Version Contract (Authoritative Source)

The version requirements are defined in `package.json`:

```json
{
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.15.4"
}
```

**Fields:**

- `engines.node` - Minimum Node.js version constraint (semver range)
- `engines.pnpm` - Minimum pnpm version constraint (semver range)
- `packageManager` - Exact pnpm version for reproducibility (optional but recommended)

**Supported constraint operators:**

- `>=` - Greater than or equal (e.g., `>=22.0.0`)
- `>` - Greater than
- `<=` - Less than or equal
- `<` - Less than
- `^` - Compatible with (caret range, e.g., `^22.0.0` = `>=22.0.0 <23.0.0`)
- `~` - Approximately equivalent (tilde range, e.g., `~22.1.0` = `>=22.1.0 <22.2.0`)
- `=` or exact version (e.g., `22.0.0`)

### Verification Script

`scripts/verify-toolchain.mjs` validates the toolchain versions:

- Reads version constraints from `package.json`
- Checks actual Node.js version (from `process.version`)
- Checks actual pnpm version (from `pnpm --version`)
- Validates that detected versions satisfy all constraints
- Exits with code 1 if any requirement is not met

### Integration with Local Verification

The toolchain check runs **first** in the unified verification workflow (`pnpm run verify:local`), before lint, typecheck, or tests. This ensures fast failure if the toolchain is incompatible.

See `scripts/verify-local.mjs`:

```javascript
function main() {
  // LGR-007: Check toolchain versions before any other verification steps
  console.log("Verifying toolchain versions...\n");
  run("node", ["scripts/verify-toolchain.mjs"]);

  // ... rest of verification steps
}
```

## Usage

### Manual Validation

```bash
# Check toolchain versions
node scripts/verify-toolchain.mjs

# Integrated into full verification
pnpm run verify:local
```

### Example Output (Success)

```text
== Toolchain Version Check (LGR-007) ==

Node.js:
  Required: >=22.0.0
  Detected: v22.22.0
  ✓ OK

pnpm:
  Required: >=9.0.0
  Exact (packageManager): 9.15.4
  Detected: 9.15.4
  ✓ Satisfies engines.pnpm

✓ All toolchain version requirements satisfied.
```

### Example Output (Failure)

```text
== Toolchain Version Check (LGR-007) ==

Node.js:
  Required: >=22.0.0
  Detected: v20.10.0
  ✖ Version mismatch!

pnpm:
  Required: >=9.0.0
  Exact (packageManager): 9.15.4
  Detected: 9.15.4
  ✓ Satisfies engines.pnpm

✖ Toolchain version requirements not met.
  Please update your Node.js and/or pnpm installation.
```

### Example Output (Version Drift Warning)

```text
== Toolchain Version Check (LGR-007) ==

Node.js:
  Required: >=22.0.0
  Detected: v22.22.0
  ✓ OK

pnpm:
  Required: >=9.0.0
  Exact (packageManager): 9.15.4
  Detected: 9.16.0
  ✓ Satisfies engines.pnpm
  ⚠ Warning: Detected version (9.16.0) differs from packageManager (9.15.4)
  Consider running: corepack install

✓ All toolchain version requirements satisfied.
```

## Updating Toolchain Requirements

When updating the required Node.js or pnpm versions:

1. Update `package.json`:

   ```json
   {
     "engines": {
       "node": ">=23.0.0",
       "pnpm": ">=10.0.0"
     },
     "packageManager": "pnpm@10.0.0"
   }
   ```

1. Update your local environment:

   ```bash
   # Install required Node.js version (via nvm, n, or other version manager)
   nvm install 23
   nvm use 23

   # Update pnpm via corepack (recommended)
   corepack install
   corepack enable pnpm

   # OR update pnpm directly
   npm install -g pnpm@10
   ```

1. Verify locally:

   ```bash
   pnpm run verify:local
   ```

1. Update documentation if the change is significant
1. Notify the team and update CI/CD configurations

## Using Corepack for Reproducible Builds

[Corepack](https://nodejs.org/api/corepack.html) is the recommended way to ensure exact pnpm versions. It comes bundled with Node.js 16.9.0+.

```bash
# Enable corepack
corepack enable

# Install exact pnpm version from package.json
corepack install

# Verify
pnpm --version  # Should match packageManager field
```

Corepack automatically installs and uses the pnpm version specified in `packageManager`, ensuring reproducibility across environments.

## Testing

The verification script is tested in `tests/scripts/verify-toolchain.test.ts`:

```bash
pnpm run test:run tests/scripts/verify-toolchain.test.ts
```

Test coverage includes:

- Version constraint validation (>=, >, <, <=, ^, ~)
- Detection of version mismatches
- Error messages with required vs detected versions
- Handling missing package.json
- Warning for version drift from packageManager
- Reading from package.json as authoritative source

## CI Integration

CI pipelines should run the toolchain check as the first step:

```yaml
- name: Verify toolchain versions
  run: node scripts/verify-toolchain.mjs

- name: Run full verification
  run: pnpm run verify:local
```

This ensures the CI environment matches team expectations before running expensive build or test steps.

## Related Documentation

- [Unified Local Verification Command](skip-only-guard.md#lgr-001) - LGR-001 (verify:local command)
- [Quality Baseline](quality-baseline.md) - QBASE-001 versioned metrics

## References

- **Issue:** #253
- **Requirement:** LGR-007 from DOC-610 (wiki)
- **Milestone:** DOC-610 Local Guardrails (LGR)
- **Script:** `scripts/verify-toolchain.mjs`
- **Tests:** `tests/scripts/verify-toolchain.test.ts`
- **Integration:** `scripts/verify-local.mjs`
