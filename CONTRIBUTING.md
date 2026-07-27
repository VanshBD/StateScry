# Contributing

Thank you for improving StateScry. Please avoid publishing packages under the
`@statescry` scope unless you are an authorized project maintainer.

## Development setup

Requirements are Node.js 24+, Corepack, and the Playwright browsers used by your test.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
```

For behavior-engine changes, run the complete Chromium suite and the focused Firefox
and WebKit explorer suite. For packaging changes, also run:

```bash
pnpm release:build
pnpm release:smoke
pnpm release:source-smoke
```

## Pull requests

- Keep safety observe-only by default and add tests for every policy change.
- State measured results separately from estimates or universal claims.
- Add migrations for persisted schema changes; never silently reinterpret newer data.
- Treat extension modules as reviewed local code, not as trusted sandboxes.
- Update README, local usage, and limitations with behavior changes.
- Do not include credentials, production storage state, screenshots, traces, or customer
  application data.

Small focused commits and reproducible fixtures are preferred. By contributing, you
agree that your work is licensed under Apache-2.0 and to follow the code of conduct.
