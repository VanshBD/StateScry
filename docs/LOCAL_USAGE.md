# Using StateScry locally

This guide covers every supported local interface: repository CLI, another application,
dashboard, authenticated personas, multiple browsers and devices, incremental mapping,
reports and CI, MCP-compatible coding agents, core API, and extensions.

StateScry does not need a cloud account or AI API key. Packages are published live on npm under `@statescry-tool`.

## 1. Prerequisites

- Node.js 24 or newer
- Corepack and pnpm
- Windows, Linux, or macOS supported by the installed Playwright release
- An application and account you are authorized to test

From the StateScry repository:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

For every locally supported browser:

```bash
pnpm exec playwright install chromium firefox webkit
```

Linux hosts may require Playwright system packages. Follow the error emitted by the
installed Playwright release rather than silently skipping that browser.

Confirm the installation:

```bash
pnpm statescry --help
pnpm statescry validate --root .
```

## 2. Choose how to run it

### Method A: evaluate the included demo

Terminal 1:

```bash
pnpm demo
```

Terminal 2:

```bash
pnpm statescry init http://127.0.0.1:4173
pnpm statescry map http://127.0.0.1:4173 --name demo-baseline
pnpm statescry show
```

### Method B: map another local project

StateScry can stay in its own repository. Point `--root` to the application repository
where configuration and `.statescry` evidence should live:

```bash
pnpm statescry --root C:/work/my-app init http://127.0.0.1:3000
pnpm statescry --root C:/work/my-app validate
pnpm statescry --root C:/work/my-app map http://127.0.0.1:3000 --name baseline
pnpm statescry --root C:/work/my-app show baseline
```

Use absolute paths in automation and MCP configuration. Start the target application
yourself before mapping it; StateScry does not guess the project's dev-server command.

### Method C: run compiled entry points directly

After `pnpm build`, the compiled CLI and MCP server are available without `tsx`:

```bash
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js --root C:/work/my-app runs
node packages/mcp/dist/bin.js
```

Set `STATESCRY_PROJECT_ROOT` when starting the MCP executable directly.

### Method D: build local package artifacts

```bash
pnpm release:build
```

Artifacts are written under `.statescry/release/`:

- four package tarballs in `.statescry/release/packages/`
- `checksums.json`
- CycloneDX SBOM
- local in-toto provenance

Because the scoped packages are not publicly published, treat the four tarballs as one
local release set. `pnpm release:smoke` demonstrates and verifies their exact installation
in an empty consumer project. The repository method is the simplest supported path for
normal local evaluation.

## 3. Initialize and validate a project

Run from the application root or pass `--root`:

```bash
pnpm statescry init http://127.0.0.1:3000
pnpm statescry validate
```

`init` creates `statescry.config.json` and refuses to overwrite an existing file unless
you explicitly pass `--force`.

A practical observe-only configuration:

```json
{
  "browser": "chromium",
  "headless": true,
  "maxStates": 100,
  "maxDepth": 8,
  "maxActionsPerState": 60,
  "actionTimeoutMs": 5000,
  "navigationTimeoutMs": 15000,
  "settleMs": 150,
  "explorationMode": "observe",
  "evidenceMode": "metadata",
  "ignoredTextPatterns": ["build-[a-f0-9]+", "Updated \\d+ seconds ago"],
  "redactPatterns": ["customer-[0-9]+"],
  "inputs": [
    {
      "selector": "#email",
      "value": "tester@example.test",
      "label": "test email"
    }
  ],
  "waitForSelectors": ["[data-app-ready]"],
  "replayAssertions": [
    { "type": "heading", "expected": "Dashboard", "mode": "equals" },
    {
      "type": "selector",
      "selector": "[data-ready]",
      "expected": "",
      "mode": "visible"
    }
  ],
  "personas": {
    "customer": {
      "role": "customer",
      "storageStatePath": ".statescry/private/customer.json"
    },
    "admin": {
      "role": "admin",
      "storageStatePath": ".statescry/private/admin.json"
    }
  },
  "viewports": {
    "desktop": { "width": 1440, "height": 900 },
    "mobile": { "width": 390, "height": 844 }
  },
  "frameworkAdapters": [{ "name": "dom-markers", "version": 1 }]
}
```

Technical schema/API version fields in configuration and extension manifests are
compatibility contracts and must remain stable for saved artifacts and extensions.

## 4. Map and inspect behavior

Start with a bounded metadata-only run:

```bash
pnpm statescry map http://127.0.0.1:3000 \
  --name baseline \
  --browser chromium \
  --max-states 100 \
  --max-depth 8 \
  --persona customer \
  --viewport desktop
```

Useful inspection commands:

```bash
pnpm statescry runs
pnpm statescry states baseline
pnpm statescry states baseline --search settings
pnpm statescry path baseline <state-id>
pnpm statescry analyze baseline
pnpm statescry history
```

Add `--json` to a top-level command when another tool should consume the result:

```bash
pnpm statescry --json runs
```

## 5. Replay with verification

Find a state ID, then replay it:

```bash
pnpm statescry states baseline --search dashboard
pnpm statescry replay baseline <state-id>
```

Replay exits with status `2` unless the final state is verified. A successful sequence
of clicks alone is never treated as success. Verification uses the expected semantic
fingerprint, URL, title, heading, and configured assertions. Add `--headed` to watch the
browser.

## 6. Compare application changes

Create a baseline, change the application, and create a candidate:

```bash
pnpm statescry map http://127.0.0.1:3000 --name baseline
pnpm statescry map http://127.0.0.1:3000 --name candidate
pnpm statescry diff baseline candidate
```

Create a PR-friendly report:

```bash
pnpm statescry report baseline candidate \
  --format markdown \
  --output behavior-report.md \
  --fail-on-change
```

For JSON automation:

```bash
pnpm statescry report baseline candidate \
  --format json \
  --output behavior-report.json \
  --fail-on-low-confidence 0.75
```

`--github-summary` appends Markdown to `GITHUB_STEP_SUMMARY` and
`--github-annotations` writes workflow annotations.

## 7. Incremental mapping

Use incremental mapping only when you can declare the changed scope honestly:

```bash
pnpm statescry map http://127.0.0.1:3000 \
  --name candidate-incremental \
  --incremental-from baseline \
  --changed-route /settings \
  --changed-selector "[data-settings-panel]" \
  --changed-file src/settings.tsx \
  --change-reason "settings experience changed"
```

StateScry records invalidation reasons and observed/reused state IDs. Unknown or
incompatible scope falls back to full mapping. Pass `--force-full` whenever the declared
scope may be incomplete.

## 8. Authentication personas, roles, and devices

Create Playwright storage-state JSON with your own authenticated test setup and keep it
private. Reference it from `statescry.config.json`, then map a matrix:

```bash
pnpm statescry matrix http://127.0.0.1:3000 \
  --personas customer,admin \
  --viewports desktop,mobile \
  --workers 2 \
  --resume
```

Compare observed access:

```bash
pnpm statescry access customer-run admin-run
```

This is an observation of the mapped contexts, not proof that the application's
authorization policy is correct.

## 9. Forms, keyboard actions, and domain actions

Configured inputs prevent the explorer from guessing form data. Mark sensitive values:

```json
{
  "inputs": [
    { "selector": "#email", "value": "tester@example.test" },
    { "selector": "#password", "value": "local-test-secret", "secret": true }
  ],
  "customActions": [
    { "name": "open command menu", "kind": "press", "key": "Control+K" },
    {
      "name": "choose plan",
      "kind": "select",
      "selector": "#plan",
      "value": "team"
    },
    { "name": "accept terms", "kind": "check", "selector": "#terms" }
  ]
}
```

An action marked `allowInObserveMode` still cannot bypass network mutation policy.

## 10. Mutating actions and lifecycle hooks

Remain in observe mode unless a disposable test environment requires mutations. Both
the mode and a matching allowlist rule are mandatory:

```json
{
  "explorationMode": "allowlist",
  "mutationAllowlist": [
    {
      "method": "POST",
      "urlPattern": "^http://127\\.0\\.0\\.1:3000/api/test-orders$",
      "reason": "disposable seeded order fixture"
    }
  ],
  "resetHook": {
    "command": "pnpm",
    "args": ["test-data:reset"],
    "timeoutMs": 30000
  },
  "seedHook": {
    "command": "pnpm",
    "args": ["test-data:seed"],
    "timeoutMs": 30000
  }
}
```

Hooks do not run unless mapping also receives `--allow-hooks`. Hook commands and
extensions are trusted local code; review them like build scripts.

## 11. Evidence modes and local storage

Choose evidence deliberately:

```bash
pnpm statescry map http://127.0.0.1:3000 --name metadata --evidence metadata
pnpm statescry map http://127.0.0.1:3000 --name visual --evidence screenshots
pnpm statescry map http://127.0.0.1:3000 --name diagnostic --evidence full
```

Project data is stored under `.statescry/`:

```text
.statescry/
├── runs/       behavior JSON and run evidence
├── sessions/   matrix checkpoints
├── imports/    imported Playwright journeys
├── quality/    benchmark, visual, and clean-room proof
├── release/    local package artifacts
└── statescry.db
```

JSON run artifacts are authoritative; SQLite is a rebuildable local index. Do not commit
`.statescry`, storage-state files, screenshots, traces, or real customer data.

## 12. Dashboard

```bash
pnpm statescry show
pnpm statescry show --port 4317
pnpm statescry show --no-open
```

The dashboard supports run selection, state filtering, graph navigation, coverage and
budget warnings, replay status, evidence links, visual comparison, behavior diff,
role/access comparison, adapters, and incremental provenance. It binds a local server;
do not expose it publicly when artifacts contain sensitive data.

## 13. MCP-compatible coding agents

Build StateScry first:

```bash
pnpm build
```

Register the stdio server in any MCP client (Cursor, Claude Desktop, Antigravity, Codex).

### Option A: Using published npm package (`npx`)

```json
{
  "mcpServers": {
    "statescry": {
      "command": "npx",
      "args": ["-y", "@statescry-tool/mcp"],
      "env": {
        "STATESCRY_PROJECT_ROOT": "C:/path/to/your-web-app"
      }
    }
  }
}
```

### Option B: From local built repository

```json
{
  "mcpServers": {
    "statescry": {
      "command": "node",
      "args": ["C:/absolute/path/to/statescry/packages/mcp/dist/bin.js"],
      "env": {
        "STATESCRY_PROJECT_ROOT": "C:/absolute/path/to/your-web-app"
      }
    }
  }
}
```

Use forward slashes or correctly escaped backslashes in JSON. Restart the MCP client
after changing its configuration.

Available tools:

| MCP tool              | Use                                                              |
| --------------------- | ---------------------------------------------------------------- |
| `map_application`     | Run bounded full or declared incremental mapping                 |
| `map_matrix`          | Map configured persona/viewport combinations                     |
| `coverage_history`    | Retrieve measured coverage history and labeled estimates         |
| `list_runs`           | List compact saved-run summaries                                 |
| `list_states`         | Search states within a run                                       |
| `find_path_to_state`  | Find the shortest known reproducible path                        |
| `replay_state`        | Replay and verify an expected final state                        |
| `compare_runs`        | Retrieve confidence-explained behavior differences               |
| `analyze_run`         | Inspect cycles, terminal states, policy limits, and risk signals |
| `compare_role_access` | Compare observed access between role/persona runs                |
| `get_state_evidence`  | Retrieve redacted evidence metadata                              |

MCP deliberately does not execute arbitrary hooks or extensions. Logs use standard
error so standard output remains valid protocol traffic.

## 14. Core API

Workspace packages can call the same deterministic engine used by the CLI and MCP:

```js
import {
  compareRuns,
  exploreApplication,
  loadRun,
  resolveExploreOptions,
} from "@statescry/core";

const projectRoot = process.cwd();
const options = await resolveExploreOptions({
  baseUrl: "http://127.0.0.1:3000",
  projectRoot,
  name: "api-run",
  browser: "chromium",
  maxStates: 50,
  maxDepth: 6,
});

const candidate = await exploreApplication(options);
const baseline = await loadRun(projectRoot, "baseline");
console.log(compareRuns(baseline, candidate));
```

The package exports configuration, exploration, storage, pathfinding, replay, analysis,
diff, benchmark, history, matrix, migration, safety, redaction, extension, and dashboard
server APIs.

## 15. Extensions

Extensions support domain actions, assertions, redactors, and state matchers. Validate a
reviewed local module before enabling it:

```bash
pnpm statescry extensions validate ./examples/invoice-extension/index.mjs
pnpm statescry extensions invoke ./examples/invoice-extension/index.mjs \
  --capability matchers \
  --input pair.json
```

List mapping extensions in configuration:

```json
{
  "extensions": ["./examples/invoice-extension/index.mjs"]
}
```

Then opt in:

```bash
pnpm statescry map http://127.0.0.1:3000 --allow-extensions
```

The host validates manifests and outputs, redacts and bounds input, enforces timeouts,
and isolates crashes. A worker is not a security sandbox and extension JavaScript can
use Node APIs. See [Extension guide](EXTENSIONS.md).

## 16. Import existing Playwright journeys

StateScry statically imports supported literal locator journeys without executing test
source:

```bash
pnpm statescry import-playwright tests/e2e \
  --output .statescry/imports/playwright-journeys.json \
  --strict
```

Dynamic control flow that cannot be recovered safely is reported as a diagnostic rather
than guessed.

## 17. CI and quality gates

Typical local checks:

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm test:visual
pnpm test:benchmark
```

Complete release verification:

```bash
pnpm release:verify
```

The repository includes GitHub Actions definitions for browser verification,
clean-source/package installation, security analysis, release artifacts, and provenance.
Hosted workflow results exist only after the repository is pushed and those workflows
run successfully.

## 18. Environment variables

All are optional for local core use:

```dotenv
STATESCRY_HEADLESS=true
STATESCRY_BROWSER=chromium
STATESCRY_MAX_STATES=100
STATESCRY_MAX_DEPTH=8
STATESCRY_STORAGE_STATE=.statescry/private/customer.json
STATESCRY_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
STATESCRY_PROJECT_ROOT=C:/absolute/path/to/project
```

`NPM_TOKEN` is only for a maintainer publishing packages; StateScry exploration does not
read it.

## 19. Troubleshooting

### Configuration is rejected

Run `pnpm statescry validate --root <project>` and use the exact reported field error.
StateScry rejects unsafe or ambiguous configuration instead of guessing.

### Browser executable is missing

```bash
pnpm exec playwright install chromium
```

Install Firefox/WebKit similarly when selected.

### No useful states are found

Check the start URL, authentication storage state, selectors, configured form inputs,
loading readiness, state/depth budgets, and coverage warnings. Use `--headed` while
diagnosing.

### Replay fails after clicks complete

That is expected when the final state no longer matches. Inspect the returned expected
versus observed fingerprint, URL, heading, assertions, and screenshot evidence. Stabilize
test data or selectors rather than weakening verification blindly.

### Mapping is blocked

Read the blocked request/action reason. Do not enable allowlist mode just to suppress a
warning; add the narrowest reviewed rule only in a disposable environment.

### MCP client cannot start the server

Confirm `pnpm build` succeeded, use absolute paths, run the configured `node .../bin.js`
command manually, set `STATESCRY_PROJECT_ROOT`, and ensure no wrapper writes logs to
standard output.

### Evidence is too large or sensitive

Use `metadata` mode, narrow budgets, add domain redaction patterns, and remove local runs
according to your own retention policy. A dedicated retention/pruning command is not yet
implemented.
