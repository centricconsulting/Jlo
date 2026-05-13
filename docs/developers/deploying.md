# Deploying

How to push changes from this repo into a NetSuite account.

## Environments

The SuiteCloud CLI stores per-account credentials under named auth IDs. The default is set in `project.json`:

```json
{
  "defaultAuthId": "jlo-sb"
}
```

| Auth ID  | Environment |
| -------- | ----------- |
| `jlo-sb` | Sandbox     |

Production auth is configured per developer machine and is intentionally **not** set as `defaultAuthId` in committed code. Switching to production for a deploy is a deliberate action, never the default state of the repo.

To switch environments, edit `defaultAuthId` in `project.json` (and revert it after the deploy if you bumped it to production).

## Deploy.xml and manifest.xml discipline

Two files control what each deploy actually pushes:

- **`src/deploy.xml`** , lists the object IDs and files included in this deploy.
- **`src/manifest.xml`** , declares the project's required features and dependencies.

> [!WARNING]
> **Rebuild `deploy.xml` from scratch per task.** Before every deploy, rewrite `deploy.xml` to contain only the objects required for the current task. Do not carry forward entries from previous deploys, that risks redeploying stale state or objects the current task did not touch.

> [!WARNING]
> **Trim `manifest.xml` to match.** It should declare only the dependencies required by the objects in the current `deploy.xml`. Excess dependencies will fail validation if they aren't present on the target account.

## Validate, then deploy

```bash
# 1. Confirm defaultAuthId in project.json is correct.

# 2. Rebuild src/deploy.xml for the task.

# 3. Trim src/manifest.xml.

# 4. Validate against the target account.
suitecloud project:validate

# 5. Deploy. Auto-runs cleanup, tsc, and tests.
suitecloud project:deploy
```

To deploy without re-running tests (emergency only):

```bash
SKIP_TESTS=true suitecloud project:deploy
```

## Pre-deploy cleanup

The deploy pipeline runs `scripts/utils/clean-orphaned-js.js` before compilation. This deletes any `.js` file under `src/FileCabinet/SuiteScripts/<subdir>/` that lacks a matching `.ts` source. The root of `src/FileCabinet/SuiteScripts/` is exempted, native JavaScript files there are preserved (see [TypeScript Workflow, native JS at the SuiteScripts root](typescript.md#the-exception-native-js-at-the-suitescripts-root)).

If you see an unexpected file being removed at deploy time, check whether it was a hand-edited JS in a subdirectory, that is the case the cleanup script is designed to catch.

## Production deploys

> [!IMPORTANT]
> Do not deploy to production unless you have been asked to.

Production deploys follow the same workflow as sandbox, but with `defaultAuthId` pointed at the production auth ID. After the deploy, revert `defaultAuthId` back to `jlo-sb` so subsequent work targets the sandbox by default.
