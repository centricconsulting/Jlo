# AGENTS.md

Shared guidance for coding agents working in this repository.

NetSuite SDF project for JLo (JLo Beauty & Lifestyle, LLC; Centric managed-services client, formerly Guthy-Renker). Account Customization Project, TypeScript compiled to AMD under `src/FileCabinet/SuiteScripts/`. Conventions, deploys, and queries come from the `ns` plugin (`/ns:build`, `/ns:deploy`, `/ns:query`, `/ns:ui`); this file holds what is specific to this project. **Detailed conventions live in `docs/developers/`.**

## Accounts

| Auth id | Account | Environment | Query Tool |
|---|---|---|---|
| `jlo-sb` | `6966778_SB1` | Sandbox | `/app/site/hosting/scriptlet.nl?script=customscript_cen_jlo_suiteql_query_tool&deploy=customdeploy_cen_jlo_suiteql_query_tool` |
| `jlo-prod` | `6966778` | Production | not deployed |

`project.json` (gitignored) currently points at `jlo-sb`. Always confirm `defaultAuthId` before `suitecloud project:deploy`.

## Deploy rules

- **No production deploy without being asked in this conversation.** Sandbox deploys (`jlo-sb`) are fine when the task calls for them. Cary deploys to production.
- `deploy.xml` (`src/deploy.xml`) is rebuilt from scratch per task with only the current task's objects; `manifest.xml` trimmed to match.
- **In `deploy.xml`, put `<files>` before `<objects>`.** NetSuite resolves a script object's `<scriptfile>` at object-create time; the reverse order passes validation and fails at "Begin deployment" with `The file ... referenced by object field 'scriptfile' could not be resolved.`
- `ns-validate` (or `suitecloud project:validate`) before every deploy.
- Never hand-edit compiled JS under `src/FileCabinet/SuiteScripts/<subdir>/`. Edit the `.ts` under `src/TypeScripts/<subdir>/` and compile.
- **Root-level JS in `src/FileCabinet/SuiteScripts/` is the deliberate exception.** Pre-SDF native JavaScript, hand-edited and deployed as-is. The orphan-cleanup script preserves them.
- `legacy/` is outside the SDF deploy scope. Do not move files from `legacy/` into `src/FileCabinet/SuiteScripts/` without confirming the file is still active in NetSuite.

## Repo history

Originally a flat dump of JavaScript (`centricconsulting/Jlo`) used by colleagues without SDF tooling. Restructured into SDF layout on `setup/sdf-restructure`; existing JS moved into `src/FileCabinet/SuiteScripts/` via `git mv`. `archive/` and `debug/` moved to top-level `legacy/`.

## Documentation map

- `README.md`: orientation, plus the "Notice for prior contributors" about the JS-only flow at `SuiteScripts/` root.
- `docs/developers/index.md`: developer landing page. Links `setup.md`, `typescript.md`, `testing.md`, `deploying.md`.

When asked "how do I X" for something covered there, read the doc rather than answering from memory.

## Naming

`customscript_cen_jlo_<domain>_<description>_<suffix>`. Org `cen`, client `jlo`. Applies to TS filename, compiled JS, script id, and base deployment id. Multi-deployment scripts append a record-type abbreviation to each deployment id.

- `<domain>`: 2-3 letters for the primary record area (`je`, `so`, `inv`, `cm`, `po`, `gl`, `wo`, `bom`, `ab`). Omit if no single area applies.
- `<description>`: short snake_case verb + thing (`clear_reversal`, `class_update`).
- `<suffix>`: always last. `_ue`, `_cs`, `_sl`, `_wa`, `_mr`, `_rl`, `_sc`, `_svc`.

**Script id / deployment id cap: 40 characters** including the `customscript_` / `customdeploy_` prefix. Abbreviate record subtypes on deployments (`_ic`, `_aic`).

Worked example:

| Artifact | Name |
|---|---|
| TS source | `src/TypeScripts/journalEntries/cen_jlo_je_reversal_ue.ts` |
| Compiled JS | `src/FileCabinet/SuiteScripts/journalEntries/cen_jlo_je_reversal_ue.js` |
| Script object | `src/Objects/usereventscript/customscript_cen_jlo_je_reversal_ue.xml` |
| Deployment ids | `customdeploy_cen_jlo_je_reversal_ue_{je,ic,st,aic}` |

Pre-SDF root JS used type-in-middle (`cen_jlo_ue_invoice_tax`); leave those alone. Domain folder under `src/TypeScripts/` groups by area; the filename carries the convention.

## Commands

```bash
tsc                            # compile
npm test                       # all tests with coverage
npm run test:unit              # unit tests only
npm test -- path/to/test       # one test file
suitecloud project:validate
suitecloud project:deploy      # auto-runs cleanup, tsc, tests
SKIP_TESTS=true suitecloud project:deploy
```

## Domains

- `journalEntries/`: JE reversal-date clear-on-copy (`cen_jlo_je_reversal_ue`).
- Root `SuiteScripts/`: pre-SDF native JS (SO/invoice tax, class updates, PO assembly item description, MR data fixes).
- `src/Objects/custtmpl_jlb_po_template`: printed PO advanced PDF template.

## Code markers

`TODO:` task, `STUB:` placeholder, `BUG:` known issue, `NOTE:` developer info, `FIXME:` critical.

## Account schema

Field maps, list values, and internal IDs live in `docs/`, not here, and shift on sandbox refresh. Verify live before relying on one.
