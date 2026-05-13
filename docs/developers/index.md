# Developer Documentation

Technical documentation for the JLo NetSuite SDF project. This section covers how the codebase is organized, the conventions for writing and compiling scripts, how to run the tests, and how to deploy.

## Getting Started

- **[Environment Setup](setup.md)** , install Node, the SuiteCloud CLI, and authenticate against the JLo sandbox.
- **[TypeScript Workflow](typescript.md)** , how TypeScript sources compile to AMD JavaScript, file headers, and import conventions.
- **[Testing](testing.md)** , Jest setup, the compiled-JS test pattern, and mocking the `N/*` modules.
- **[Deploying](deploying.md)** , environments, `deploy.xml` / `manifest.xml` discipline, and the validate / deploy commands.

## Repository layout

```
src/
  TypeScripts/         TypeScript sources (edit here)
  FileCabinet/
    SuiteScripts/      Compiled JS + native JS at root (deployed)
  Objects/             NetSuite metadata XML
  deploy.xml           Per-deploy object list
  manifest.xml         Project manifest
__tests__/             Jest tests (run against compiled JS)
scripts/               Build + maintenance utilities
legacy/                Pre-SDF archive, outside deploy scope
docs/                  This documentation
```

`src/TypeScripts/` is the only place to edit TypeScript. The compiler emits AMD modules into `src/FileCabinet/SuiteScripts/<subdir>/`. Native JavaScript files at the **root** of `src/FileCabinet/SuiteScripts/` predate the SDF restructure and are hand-edited as-is, the orphan-cleanup script leaves them alone.

## Common commands

```bash
npm run tsc                    # Compile TypeScript
npm test                       # All tests with coverage
npm run test:unit              # Unit tests only
npm run lint                   # ESLint
suitecloud project:validate    # Validate before deploy
suitecloud project:deploy      # Deploy (auto-runs cleanup, tsc, tests)
SKIP_TESTS=true suitecloud project:deploy
```

## Script type suffixes

| Suffix | Type             | Entry points                                |
| ------ | ---------------- | ------------------------------------------- |
| `_ue`  | User Event       | `beforeLoad`, `beforeSubmit`, `afterSubmit` |
| `_cs`  | Client Script    | `pageInit`, `saveRecord`, `fieldChanged`    |
| `_sl`  | Suitelet         | `onRequest`                                 |
| `_wa`  | Workflow Action  | `onAction`                                  |
| `_mr`  | Map/Reduce       | `getInputData`, `map`, `reduce`, `summarize` |
| `_rl`  | RESTlet          | `get`, `post`, `put`, `delete`              |
| `_sc`  | Scheduled Script | `execute`                                   |
| `_svc` | Service module   | (called by other scripts)                   |

## Code markers

| Marker   | Meaning                                  |
| -------- | ---------------------------------------- |
| `TODO:`  | Task to complete                         |
| `STUB:`  | Placeholder needing real implementation  |
| `BUG:`   | Known issue                              |
| `NOTE:`  | Important info for developers            |
| `FIXME:` | Critical issue needing immediate attention |

## Related sections

- [Administrator Documentation](../admins/index.md) , deployment procedures and configuration (to be expanded).
- [User Documentation](../users/index.md) , end-user documentation (to be expanded).
