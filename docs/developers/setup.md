# Environment Setup

What you need installed and configured before you can compile, test, and deploy this project.

## Prerequisites

- **Node.js** with `npm >= 8`. Match the version pinned in `package.json` (`packageManager: npm@10.0.0`).
- **TypeScript** is installed as a dev dependency, no global install needed.
- **SuiteCloud CLI** , Oracle's tool for SDF projects. Install per [Oracle's documentation](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1558708810.html).
- A NetSuite account with SDF permissions on the JLo sandbox.

## Install dependencies

From the repo root:

```bash
npm install
```

This pulls in TypeScript, Jest, the SuiteCloud unit-testing harness, ESLint, and the NetSuite type definitions.

## Authenticate with NetSuite

The SuiteCloud CLI stores account credentials under a named `authId`. Set up the sandbox authentication once:

```bash
suitecloud account:setup
```

Follow the interactive prompts; name the auth `jlo-sb`. The repo's `project.json` already references `jlo-sb` as the default.

To verify it worked:

```bash
suitecloud account:manageauth --list
```

## Verify the build

Compile TypeScript and run the test suite to confirm everything is wired up:

```bash
npm run tsc
npm test
```

You should see compiled `.js` files appear under `src/FileCabinet/SuiteScripts/<subdir>/` and Jest reporting passing tests.

## Next steps

- [TypeScript Workflow](typescript.md) , how sources compile, file header conventions, import style.
- [Testing](testing.md) , how the Jest suite is structured.
- [Deploying](deploying.md) , environment switching and the deploy.xml / manifest.xml workflow.
