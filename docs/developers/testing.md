# Testing

The repo uses `@oracle/suitecloud-unit-testing` with Jest. Tests run against the **compiled JavaScript**, not the TypeScript source, which matches what NetSuite executes.

## Running tests

```bash
npm test                       # All tests with coverage
npm run test:unit              # Unit projects only
npm test -- --watch            # Watch mode
npm test -- path/to/test.js    # Specific test file
```

`suitecloud project:deploy` runs the suite before deploying. Set `SKIP_TESTS=true` to bypass for an emergency deploy, but the default expectation is that tests pass.

## Layout

```
__tests__/
  <domain>/
    fixtures/        Shared test data
    models/          Pure-logic model tests
    services/        (Service tests usually validated in sandbox, not unit tested)
```

The test tree mirrors `src/TypeScripts/`. Coverage is computed via `collectCoverageFrom` in `jest.config.js`, which excludes script entry points (anything that imports `N/*`) since those rely on the NetSuite runtime.

## The compiled-JS pattern

Tests import the **compiled output**, not the `.ts` source:

```javascript
const Foo = require('SuiteScripts/<domain>/models/Foo');
```

This means you must run `npm run tsc` (or `tsc --watch`) before tests pick up TS changes. `npm test` does not invoke the compiler.

## Mocking `N/*` modules

Anything that imports a NetSuite module needs the module mocked before the unit under test is required:

```javascript
jest.mock('N/log', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  audit: jest.fn(),
}));

jest.mock('N/record', () => ({
  load: jest.fn(),
  save: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const myScript = require('SuiteScripts/<domain>/myScript');
```

Reset mocks between tests with `jest.clearAllMocks()` so per-test expectations don't leak.

## What to unit test, what to validate in sandbox

| Layer                                      | Coverage approach                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| **Pure-logic models** (no `N/*` imports)   | Unit tested directly. No mocking needed.                                |
| **Services** (orchestrate `N/*` calls)     | Light unit tests with mocks for branching logic. Real behavior verified in sandbox. |
| **Scripts** (entry points)                 | Excluded from coverage. Validated end-to-end in sandbox.                |

The bias is toward extracting logic into pure models so it can be tested without running NetSuite. Services and scripts stay thin.

## Fixtures

`__tests__/<domain>/fixtures/` holds shared test data. Treat fixtures as the source of truth for "what does a record look like in this domain", reuse them across tests rather than hand-rolling sample objects in each file.
