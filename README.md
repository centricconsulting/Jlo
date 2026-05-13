# JLo SuiteCloud

NetSuite SDF project for JLo. Account Customization Project (ACP), not a SuiteApp. TypeScript sources compile to AMD modules deployed into the customer's NetSuite File Cabinet.

For detailed guidance, see the [developer documentation](docs/developers/index.md).

## Requirements

- Node.js with npm >= 8
- TypeScript (installed as a dev dependency)
- [SuiteCloud CLI](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1558708810.html) authenticated against the target account

Full setup steps: [Environment Setup](docs/developers/setup.md).

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
docs/                  Documentation (read on GitHub)
```

## Notice for prior contributors (JavaScript-only is still fine)

**If you worked on this repo before the SDF restructure, the JavaScript files you remember are all still here, in the same hand-edited form, and TypeScript does not touch them.**

- **Where they live:** `src/FileCabinet/SuiteScripts/` (root level). Every `.js` that existed before the restructure is at this path , e.g. `cen_jlo_mr_correct_payments.js`, `JLO_UE_Set_INV_Date_To_SO_Date.js`, `centric_jlb_je_default_ue.js`. File history is preserved (`git mv`), so `git log` and `git blame` still work.
- **How to edit one:** open the `.js`, change it, commit. That is the whole flow. Do not compile, do not generate, do not run TypeScript.
- **The orphan-cleanup script will not delete them.** Root-level JS is explicitly skipped (see `scripts/utils/clean-orphaned-js.js`). This is by design so the pre-SDF files keep working as native JavaScript.
- **`archive/` and `debug/` moved to `legacy/`.** Same files, new home, outside the deploy scope. Treat `legacy/` as read-only reference, don't move files back without confirming they are still active in NetSuite.
- **You do not need to learn TypeScript to keep contributing.** Editing or fixing the JS scripts above is a fully supported workflow.

## New work uses TypeScript

New scripts (and any rewrites of existing ones) are written in TypeScript under `src/TypeScripts/<domain>/`. Compiled output lands in `src/FileCabinet/SuiteScripts/<domain>/` and is what gets deployed.

Conventions for file headers, imports, and the design philosophy are documented in [TypeScript Workflow](docs/developers/typescript.md).

## Common commands

```bash
npm run tsc                    # Compile TypeScript
npm test                       # All tests with coverage
npm run lint                   # ESLint
suitecloud project:validate    # Validate before deploy
suitecloud project:deploy      # Deploy (runs cleanup, tsc, tests)
SKIP_TESTS=true suitecloud project:deploy
```

## Deploying

The summary: confirm `defaultAuthId` in `project.json`, rebuild `src/deploy.xml` for the current task, trim `src/manifest.xml` to match, then `suitecloud project:validate` and `suitecloud project:deploy`.

Full workflow and environment table: [Deploying](docs/developers/deploying.md).

## Script type suffixes

| Suffix  | Type              |
|---------|-------------------|
| `_ue`   | User Event        |
| `_cs`   | Client Script     |
| `_sl`   | Suitelet          |
| `_wa`   | Workflow Action   |
| `_mr`   | Map/Reduce        |
| `_rl`   | RESTlet           |
| `_sc`   | Scheduled Script  |
| `_svc`  | Service module    |

## Further reading

- [Developer docs](docs/developers/index.md) , layout, TypeScript workflow, testing, deploying.
- `CLAUDE.md` , project rules and pointers for Claude Code sessions.
