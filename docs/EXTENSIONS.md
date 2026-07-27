# Extension guide

An extension exports a manifest with `schemaVersion: 1`, `apiVersion: 1`, semantic
version, capabilities, and matching handlers. Supported capabilities are `actions`,
`assertions`, `redactors`, and `matchers`.

```bash
statescry extensions validate ./extension.mjs
statescry extensions invoke ./extension.mjs --capability matchers --input pair.json
```

Mapping extensions must be listed in `statescry.config.json` and enabled explicitly
with `--allow-extensions`. Extension actions do not bypass origin/request policy. Mark an
action `allowInObserveMode: true` only after reviewing that the interaction itself is
safe; mutating network methods remain blocked without the normal allowlist.

The host sends sanitized bounded data into an empty-environment worker and validates
bounded output. Timeout/crash isolation protects the mapping process, but JavaScript in
a worker can still use Node APIs. Treat extensions like local build scripts. See
`examples/invoice-extension` and `packages/sdk/README.md`.
