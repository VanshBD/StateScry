<p align="center">
  <img src="assets/brand/statescry-lockup-dark.webp" alt="StateScry" width="720" />
</p>

<h1 align="center">Behavioral memory for web applications</h1>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-22c55e.svg" /></a>
  <img alt="Node.js 24 or newer" src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" />
  <img alt="Chromium, Firefox, and WebKit" src="https://img.shields.io/badge/browsers-Chromium%20%7C%20Firefox%20%7C%20WebKit-5ee590.svg" />
  <img alt="MCP compatible" src="https://img.shields.io/badge/MCP-compatible-22c55e.svg" />
  <img alt="Local first" src="https://img.shields.io/badge/runtime-local--first-0b1424.svg" />
</p>

<p align="center">
  Map what users can do. Verify that it still works. Give developers and coding agents
  durable runtime context.
</p>

<p align="center">
  <img src="assets/brand/statescry-behavior-graph-hero.webp" alt="StateScry maps a running web application into a semantic behavior graph used for verified replay, behavior comparison, evidence, and coding-agent context" width="100%" />
</p>

<p align="center">
  <a href="#the-problem-it-solves">Problem</a> ·
  <a href="#what-the-product-includes">Capabilities</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#available-interfaces">Interfaces</a> ·
  <a href="#safety-and-privacy-boundary">Safety</a> ·
  <a href="#why-developers-may-not-use-it-yet">Adoption barriers</a> ·
  <a href="#what-is-still-missing">Current gaps</a> ·
  <a href="docs/LOCAL_USAGE.md">Complete local guide</a>
</p>

StateScry explores an authorized web application, turns meaningful UI states into a
graph, records the safe actions connecting them, and preserves evidence that can be
queried, replayed, compared, and shared with coding agents. It is local-first and its
deterministic core does not require an account, cloud service, paid AI API, or secret
API key.

StateScry is ready for local development and evaluation from this repository. Its
source, CLI, dashboard, core API, MCP server, extension SDK, tests, and local release
artifacts work together. The packages are not yet published to a public registry, and
hosted release workflows, package ownership, and trademark review remain external
public-release steps.

## The problem it solves

Source control remembers code, but it does not remember what a user could actually do.
Traditional tests usually cover journeys someone predicted in advance. Link crawlers
miss application semantics, screenshot tools focus on pixels, and AI coding agents
normally see source files without a durable model of runtime behavior.

StateScry adds that missing behavioral layer:

```text
running application
      ↓ safe bounded exploration
semantic state graph + evidence
      ↓
inspect · replay · compare · report · query through MCP
```

This helps answer questions such as:

- What states and actions are reachable for this user, role, device, or feature set?
- What is the shortest known path to reproduce a state?
- Did a code change alter behavior, or only visual/data details?
- Can the expected final state still be verified after replay?
- Did an ordinary user gain access to something only an administrator previously saw?
- Which areas were explored, blocked by policy, truncated by budget, or never observed?
- What runtime context can a coding agent retrieve without receiving a huge trace dump?

## What the product includes

| Capability          | What StateScry provides                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Safe exploration    | Same-origin, observe-only defaults; mutating requests require an explicit mode and matching method/URL allowlist                                 |
| State discovery     | SPA routes, hash routes, forms, keyboard actions, modals, loading/error states, configured inputs, feature context, and stable framework signals |
| Bounded coverage    | State, depth, action, and time budgets with honest policy/budget/execution status instead of exhaustive claims                                   |
| Behavioral graph    | Semantic fingerprints, transitions, shortest paths, terminal/cycle analysis, and JSON artifacts with a rebuildable SQLite index                  |
| Verified replay     | Final fingerprint, URL, title, heading, and configurable assertion checks; failed verification returns failure evidence                          |
| Behavior comparison | Confidence-scored cross-build matching with explanations, added/removed/changed states, and risk signals                                         |
| Roles and devices   | Authentication personas, storage state, viewport matrices, role-access comparison, checkpoints, and deterministic atlas merging                  |
| Incremental mapping | Declared route/selector/file invalidation, observed-versus-reused provenance, and a forced-full fallback                                         |
| Evidence            | Redacted metadata plus optional screenshots, accessibility data, console/network diagnostics, and traces                                         |
| Developer workflow  | JSON/Markdown reports, meaningful exit codes, GitHub annotations/summary support, CI workflows, benchmark scoring, and clean-room release checks |
| Dashboard           | Graph navigation, filtering, coverage warnings, replay status, role comparison, visual evidence, behavior diff, and incremental history          |
| MCP                 | Eleven compact stdio tools for mapping and querying behavior from MCP-compatible coding agents                                                   |
| Extension SDK       | Reviewed local actions, assertions, redactors, and matchers with validation, bounded I/O, timeout, and crash isolation                           |

## Quick start

Requirements: Node.js 24+, Corepack/pnpm, and a Playwright-supported operating system.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

Run the included application in one terminal:

```bash
pnpm demo
```

In another terminal:

```bash
pnpm statescry init http://127.0.0.1:4173
pnpm statescry map http://127.0.0.1:4173 --name baseline
pnpm statescry runs
pnpm statescry show
```

The complete walkthrough—including another local project, authenticated personas,
Firefox/WebKit, dashboard, comparisons, CI, MCP clients, core API, and extensions—is in
[Local usage guide](docs/LOCAL_USAGE.md).

## Available interfaces

### CLI

The `statescry` command supports initialization, configuration validation, full and
incremental mapping, persona/device matrices, run and state search, path finding,
verified replay, analysis, behavior diff, role comparison, reports, benchmark scoring,
Playwright journey import, extension inspection/invocation, dashboard serving, and MCP.

```bash
pnpm statescry --help
pnpm statescry <command> --help
```

### Dashboard

```bash
pnpm statescry show
pnpm statescry show --port 4317
```

The server reads local artifacts from `.statescry`; it is not a hosted account or data
service.

### MCP server

The stdio MCP server exposes:

`map_application`, `map_matrix`, `coverage_history`, `list_runs`, `list_states`,
`find_path_to_state`, `replay_state`, `compare_runs`, `analyze_run`,
`compare_role_access`, and `get_state_evidence`.

It keeps responses compact and does not expose arbitrary hook or extension execution.
See [MCP setup](docs/LOCAL_USAGE.md#mcp-compatible-coding-agents).

### Packages

- `@statescry/core` — exploration, graph/storage, replay, diff, analysis, server, and API
- `@statescry/cli` — command line and compiled dashboard
- `@statescry/mcp` — compact stdio MCP server
- `@statescry/sdk` — extension contracts, validation, redaction, and isolated host

The repository can generate installable tarballs, checksums, a CycloneDX SBOM, and
local provenance with `pnpm release:build`. Public registry publishing is intentionally
separate.

## Safety and privacy boundary

StateScry defaults to metadata-only evidence and observe mode. POST, PUT, PATCH, and
DELETE requests are blocked unless `explorationMode` is `allowlist` and the request
matches an explicit method/URL rule. Hooks and extensions also require explicit CLI
enablement.

Common tokens, cookies, authorization values, API-key patterns, secret input fields,
URLs, and structured fields are redacted before persistence. Screenshots and traces can
still contain visible application or customer data; enable them only in controlled test
environments.

StateScry is not a hostile-code sandbox, vulnerability scanner, formal security proof,
or guarantee of exhaustive reachability. Use test applications, test accounts, and data
you are authorized to inspect. Read [Threat model](THREAT_MODEL.md) and
[Known limitations](docs/LIMITATIONS.md).

## Why a developer would use it

- It preserves behavior across sessions instead of producing a one-time crawler result.
- Replay success means the expected state was verified, not merely that clicks ran.
- Every diff match includes confidence and an explanation.
- Coverage boundaries distinguish explored, terminal, policy-limited, depth-limited,
  budget-limited, and failed states.
- The same graph supports human debugging, CI reports, dashboard inspection, and MCP
  coding agents.
- It works without sending application behavior to a paid AI or hosted analysis API.
- Roles, devices, feature context, and authenticated storage states are first-class.
- Incremental mapping can reuse compatible unaffected observations while recording why.

## Why developers may not use it yet

These are the real adoption barriers, not hidden marketing caveats:

| Barrier                       | Practical impact                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No public package release yet | Users must clone this repository or consume locally built artifacts instead of installing from a registry                                                         |
| Playwright/browser setup      | The first install is heavier than a source-only lint tool and may need platform browser dependencies                                                              |
| Initial configuration cost    | Auth, safe form values, dynamic-text normalization, seed/reset behavior, and domain actions may need project-specific setup                                       |
| Bounded black-box observation | StateScry cannot prove it found every state or permission defect, especially behind unknown data or business rules                                                |
| Test-data stability           | Expired sessions, random data, clocks, unstable selectors, and shared environments can reduce replay reliability                                                  |
| Side-effect uncertainty       | A harmless-looking UI action can trigger domain-specific mutations; teams must keep observe mode or review allowlists carefully                                   |
| Evidence sensitivity and size | Screenshots/traces can expose visible data and consume significant storage                                                                                        |
| New workflow category         | Teams already invested in Playwright, visual regression, or proprietary testing platforms must see enough unique value to add another behavior artifact           |
| Framework depth               | Stable DOM/framework markers are supported, but StateScry deliberately avoids relying on private React/Vue internals                                              |
| Extension trust               | Worker isolation contains crashes and timeouts but does not make untrusted JavaScript safe                                                                        |
| SQLite runtime warning        | Node currently labels its SQLite API experimental; portable JSON remains authoritative                                                                            |
| Limited public proof          | Local Windows and browser gates pass, but hosted cross-platform workflow results, public users, ecosystem integrations, and long-term field data do not exist yet |

## What is still missing

The local product is functional, but these areas would materially improve adoption:

- Public registry packages and a finalized repository release process
- Hosted Windows/Linux/macOS and dependency/security evidence from the public repository
- More framework and application fixtures maintained by independent contributors
- Easier interactive configuration for authentication, forms, normalization, and domain
  actions
- A storage retention/pruning command for large evidence collections
- Broader import/export integrations with existing test management and CI platforms
- Long-running field measurements for false matches, replay stability, mapping cost, and
  upgrade compatibility on real applications
- Public documentation site, examples gallery, community support history, and migration
  guidance after external releases exist

These gaps do not prevent local use, but they explain why a cautious team may evaluate
StateScry before adopting it broadly.

## Verification

The repository currently passes:

- formatting and TypeScript checks across all workspaces
- 21 automated test files and 53 tests
- all eight exploration scenarios on Chromium, Firefox, and WebKit
- production builds and desktop/mobile dashboard visual QA
- an incremental fixture with 100% route recall, verified replay, one state observed and
  nine safely reused, zero unrelated diff changes, and zero completed unapproved mutations
- clean-source and final-tarball consumer tests
- checksums, SBOM, and local provenance generation

Run the complete local gate:

```bash
pnpm release:verify
```

The measurements prove the committed fixtures and thresholds, not universal coverage or
performance.

## Documentation

- [Local usage guide](docs/LOCAL_USAGE.md)
- [Architecture](ARCHITECTURE.md)
- [Distribution and verification](docs/DISTRIBUTION.md)
- [Extension guide](docs/EXTENSIONS.md)
- [Browser support](docs/BROWSER_SUPPORT.md)
- [Known limitations](docs/LIMITATIONS.md)
- [Threat model](THREAT_MODEL.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
