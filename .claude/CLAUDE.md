# CLAUDE.md

Guidance for Claude Code (claude.ai/code) sessions in this repository. **Detailed conventions live in `docs/developers/`** , this file holds project context plus the rules that need to be in front of you every session.

## Project Overview

NetSuite SDF project for JLo (Centric client). Account Customization Project (ACP), not a SuiteApp. TypeScript compiles to AMD modules under `src/FileCabinet/SuiteScripts/`; pre-existing native JavaScript lives at the **root** of `SuiteScripts/`.

## Repo history

This repo was originally a flat dump of JavaScript files (`centricconsulting/Jlo`) used by colleagues without SDF tooling. It was restructured into SDF layout on `setup/sdf-restructure`. Existing JS files moved into `src/FileCabinet/SuiteScripts/` (preserving git history via `git mv`). `archive/` and `debug/` moved to a top-level `legacy/` folder, kept outside the SDF deploy scope.

## Documentation map

The repo is documented for two audiences. Prefer reading these over re-deriving conventions:

- `README.md` , top-level orientation. Includes the "Notice for prior contributors" about the JS-only flow at `src/FileCabinet/SuiteScripts/` root.
- `docs/developers/index.md` , landing page for the developer docs (also served via `npm run docs:serve`). Links to:
  - `docs/developers/setup.md` , environment setup, install, auth.
  - `docs/developers/typescript.md` , TS source flow, file headers, imports, design philosophy, native-JS-at-root exception.
  - `docs/developers/testing.md` , Jest setup, the compiled-JS test pattern, mocking `N/*`.
  - `docs/developers/deploying.md` , environments, `deploy.xml` / `manifest.xml` discipline, validate/deploy.

When the user asks "how do I X" for X covered above, read the relevant doc rather than answering from memory.

## Critical Rules

These are the non-negotiables for Claude sessions; the developer docs explain them in more detail.

- **No production deploys without being asked.** Sandbox deploys (`jlo-sb`) are fine when the task calls for it. Always confirm `defaultAuthId` in `project.json` before running `suitecloud project:deploy`.
- **`deploy.xml`** / "the deployment file" refers to `src/deploy.xml`. Before deploying, rebuild it from scratch with **only** the objects for the current task. Do not carry forward objects from previous deploys.
- **`manifest.xml`** must be trimmed to only the dependencies required by the objects in the current `deploy.xml`.
- **Never hand-edit JS under `src/FileCabinet/SuiteScripts/<subdir>/`.** Those are TypeScript build outputs. Edit the `.ts` under `src/TypeScripts/<subdir>/` and compile.
- **Root-level JS in `src/FileCabinet/SuiteScripts/` is the deliberate exception.** Those are pre-SDF native JavaScript files, hand-edited and deployed as-is. The orphan-cleanup script preserves them.
- **`legacy/` is outside the SDF deploy scope.** Do not move files from `legacy/` into `src/FileCabinet/SuiteScripts/` without confirming the file is still active in NetSuite.

## Quick command reference

```bash
tsc                            # Compile TypeScript
npm test                       # All tests with coverage
npm run test:unit              # Unit tests only
npm test -- path/to/test       # Specific test file
suitecloud project:validate    # Validate before deploy
suitecloud project:deploy      # Deploy (auto-runs cleanup, tsc, tests)
SKIP_TESTS=true suitecloud project:deploy
```

See `docs/developers/index.md` for the full command and suffix reference.

## Code Markers

- `TODO:` , Task to complete
- `STUB:` , Placeholder needing real implementation
- `BUG:` , Known issue
- `NOTE:` , Important info for developers
- `FIXME:` , Critical issue needing immediate attention
