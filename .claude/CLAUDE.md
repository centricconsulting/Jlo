# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NetSuite SDF project for JLo (Centric client). Account Customization Project (ACP), not a SuiteApp. TypeScript compiles to AMD modules under `src/FileCabinet/SuiteScripts/`; pre-existing native JavaScript lives at the root of `SuiteScripts/`.

## Repo history

This repo was originally a flat dump of JavaScript files (`centricconsulting/Jlo`) used by colleagues without SDF tooling. It was restructured into SDF layout in `setup/sdf-restructure`. Existing JS files moved into `src/FileCabinet/SuiteScripts/` (preserving git history via `git mv`). `archive/` and `debug/` moved to a top-level `legacy/` folder, kept outside the SDF deploy scope.

## Commands

```bash
# Compile TypeScript (must run before deployment)
tsc

# Run all tests with coverage
npm test

# Run only unit tests
npm run test:unit

# Run a specific test file
npm test -- path/to/test

# Watch mode
npm test -- --watch

# Validate before deploy
suitecloud project:validate

# Deploy to NetSuite (auto-runs: cleanup, tsc, tests)
suitecloud project:deploy

# Skip tests during deploy
SKIP_TESTS=true suitecloud project:deploy
```

### Switching Accounts

Switch between NetSuite environments by editing `project.json`:

```json
{
  "defaultAuthId": "jlo-sb"
}
```

| Auth ID | Environment |
|---------|-------------|
| `jlo-sb` | Sandbox |

(Add production auth ID here once configured. Never set production as the default.)

## Architecture

### Directory Structure
- `src/TypeScripts/` , TypeScript source (EDIT HERE). Organize by domain.
- `src/FileCabinet/SuiteScripts/` , compiled JavaScript AND native JS at root. Subdirectory JS is AUTO-GENERATED from TS; never edit. Root-level JS is native (legacy from pre-SDF days).
- `src/Objects/` , NetSuite metadata XML files (imported via `suitecloud object:import`).
- `__tests__/` , Test files mirroring TypeScripts structure.
- `legacy/` , Archived/debug JS from the pre-SDF era. Outside the SDF deploy scope. Preserved for reference, not deployed.

### TypeScript Compilation
- Source: `src/TypeScripts/` , Output: `src/FileCabinet/SuiteScripts/`
- Module format: AMD (required by NetSuite)
- Orphaned JS files in subdirectories are auto-cleaned before deploy. Root-level JS files are preserved (see `scripts/utils/clean-orphaned-js.js`).

### Native JS at root convention
Pre-existing JS files live at the root of `src/FileCabinet/SuiteScripts/`. The orphan-cleanup script explicitly skips them (lines 29-31 of `clean-orphaned-js.js`). If you rewrite one in TypeScript, place the `.ts` under `src/TypeScripts/<subdir>/` so the compiled `.js` lands in `src/FileCabinet/SuiteScripts/<subdir>/`, not at root.

### Script Types and Suffixes
- `_ue` , User Event (record triggers)
- `_cs` , Client Script (browser form events)
- `_sl` , Suitelet (custom pages)
- `_wa` , Workflow Action
- `_mr` , Map/Reduce (large data)
- `_rl` , RESTlet (API endpoints)
- `_sc` , Scheduled Script
- `_svc` , Service (orchestrates models + NetSuite APIs, called by scripts)

### TypeScript Conventions

**Import style (intentional dual convention):**
- NetSuite modules use AMD require: `import log = require('N/log');`
- Internal modules use ES6 import: `import { Foo } from '../models/Foo';`

**File headers:** Every script file needs NetSuite JSDoc decorators:
```typescript
/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
```

**Design philosophy:**
- Keep TypeScript simple. The compiled JS should be readable by non-TypeScript developers.
- Use explicit types on function parameters and return values.
- Prefer clear control flow over ternary chains or complex generics.
- Use `as const` enums rather than the TypeScript `enum` keyword.

## Critical Rules

- DO NOT deploy to production without being asked. Sandbox deploys (`jlo-sb`) are fine when the task calls for it; always confirm the `defaultAuthId` in `project.json` before running `suitecloud project:deploy`.
- `deploy.xml` or "the deployment file" refers to `src/deploy.xml`.
- Before deploying, rebuild `deploy.xml` from scratch with ONLY the objects for the current task. Do not carry forward objects from previous deployments.
- Before deploying, trim `manifest.xml` to only include dependencies required by the objects in `deploy.xml`.
- The `legacy/` folder is outside the SDF deploy scope. Do not move files from `legacy/` into `src/FileCabinet/SuiteScripts/` without confirming the file is still active in NetSuite.

## Testing

Uses `@oracle/suitecloud-unit-testing` with Jest. Tests run against compiled JS, not TypeScript source.

### Structure
- Unit tests: `__tests__/[domain]/models/*.test.js`, `__tests__/[domain]/services/*.test.js`
- Fixtures: `__tests__/[domain]/fixtures/*.js` (shared test data)
- Scripts (entry points with N/* deps) excluded from coverage via `collectCoverageFrom`; pure logic models are testable

### Patterns
- **Tests import compiled JS**: `require('SuiteScripts/<domain>/models/Foo')`, not the `.ts` source
- **Mock N/* modules** before importing the module under test. Reset with `jest.clearAllMocks()` in `beforeEach`.
- **Pure logic models** need no mocking. Test directly.
- **Services and scripts** depend on NetSuite APIs and are validated in sandbox, not unit tested.

## Code Markers

- `TODO:` , Task to complete
- `STUB:` , Placeholder needing real implementation
- `BUG:` , Known issue
- `NOTE:` , Important info for developers
- `FIXME:` , Critical issue needing immediate attention
