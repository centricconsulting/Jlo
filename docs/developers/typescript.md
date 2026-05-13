# TypeScript Workflow

How the TypeScript source under `src/TypeScripts/` becomes JavaScript that NetSuite executes, plus the conventions every script in this repo follows.

## Source of truth

- **Edit:** `src/TypeScripts/<domain>/<file>.ts`
- **Compiled output:** `src/FileCabinet/SuiteScripts/<domain>/<file>.js` (AMD module)
- **Deployed:** everything under `src/FileCabinet/SuiteScripts/` that is referenced by `deploy.xml`

The TypeScript compiler is invoked through `npm run tsc` (or directly as `tsc`). The `suitecloud project:deploy` command runs the compile step automatically before pushing to NetSuite.

> [!WARNING]
> Never hand-edit compiled JS in a subdirectory. Anything under `src/FileCabinet/SuiteScripts/<subdir>/` is regenerated on the next `tsc` run, edits there are lost. The `scripts/utils/clean-orphaned-js.js` script also deletes any subdirectory JS that lacks a matching TS source, which prevents drift.

## The exception: native JS at the SuiteScripts root

Files at the **root** of `src/FileCabinet/SuiteScripts/` (no subdirectory) are pre-SDF native JavaScript. They are hand-edited and deployed as-is.

- Examples: `cen_jlo_mr_correct_payments.js`, `JLO_UE_Set_INV_Date_To_SO_Date.js`, `centric_jlb_je_default_ue.js`.
- The orphan-cleanup script is configured to skip the root directory (see `scripts/utils/clean-orphaned-js.js`).
- If you rewrite one of these in TypeScript, place the new `.ts` under `src/TypeScripts/<domain>/` so the compiled `.js` lands in `src/FileCabinet/SuiteScripts/<domain>/`, never at the root.

## File headers

Every script needs NetSuite JSDoc decorators at the top of the file. Without them, NetSuite rejects the deployment.

```typescript
/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
```

`@NScriptType` matches the script's role: `UserEventScript`, `ClientScript`, `Suitelet`, `MapReduceScript`, `RESTlet`, `ScheduledScript`, `WorkflowActionScript`. Service modules (no NetSuite entry point) omit `@NScriptType`.

## Imports

The repo uses a deliberate dual convention:

```typescript
// NetSuite modules: AMD-style require
import log = require('N/log');
import record = require('N/record');
import search = require('N/search');

// Internal modules: ES6 import
import { Foo } from '../models/Foo';
import { computeTax } from '../services/taxService';
```

The AMD form is what the NetSuite runtime expects when it loads compiled modules. The ES6 form is what TypeScript prefers for everything else, and the AMD output handles it correctly.

## Design philosophy

The TypeScript in this repo stays plain on purpose. Compiled output should be legible to someone who has never written TypeScript.

- **Explicit types** on function parameters and return values.
- **Plain control flow** , prefer clear `if` / early returns over ternary chains.
- **No advanced generics.** If a type is genuinely needed, write it out.
- **`as const` objects** in place of the TypeScript `enum` keyword:

  ```typescript
  export const ApprovalStatus = {
    Pending: 'pending',
    Approved: 'approved',
    Rejected: 'rejected',
  } as const;

  export type ApprovalStatus = typeof ApprovalStatus[keyof typeof ApprovalStatus];
  ```

## Adding a new script

1. Create the `.ts` file under the appropriate domain: `src/TypeScripts/<domain>/<script_name>_<suffix>.ts`. Use the suffix that matches the script type (see the suffix table in [the developer index](index.md#script-type-suffixes)).
2. Add the NetSuite JSDoc header.
3. Compile: `npm run tsc`. Confirm the matching `.js` appears under `src/FileCabinet/SuiteScripts/<domain>/`.
4. Add or update the NetSuite metadata XML in `src/Objects/` (or import it with `suitecloud object:import`).
5. List the script object in `src/deploy.xml` for the deploy.
6. Validate, then deploy.

The full deploy steps are in [Deploying](deploying.md).

## When working in a pre-SDF JS file

If your task is editing one of the root-level `.js` files in `src/FileCabinet/SuiteScripts/`:

1. Open the `.js` and edit it directly.
2. Commit.
3. Deploy.

No TypeScript involvement. The file's header decorators are already in place; preserve them. If the script needs significant rework, raise whether to rewrite it in TypeScript before doing the work, the conversion is a separate decision from the bug fix in front of you.
