# Architecture

StateScry is a local-first TypeScript workspace with four public packages:

```text
@statescry/sdk  -> versioned extension types, validation, redaction, worker host
@statescry/core -> mapping, graph/storage, replay, diff, benchmark, matrix, history
@statescry/mcp  -> compact stdio tools backed by core
@statescry/cli  -> commands plus the compiled local dashboard
```

The explorer launches a fresh Playwright context per replay path, enforces origin and
request policy before navigation, captures redacted semantic signals, fingerprints the
state, and persists a versioned graph plus evidence. Incremental mapping computes an
auditable invalidation frontier, reuses compatible unaffected states with provenance,
and re-explores changed descendants. Matrix sessions namespace every context, use
bounded concurrency, and checkpoint completed runs before deterministic atlas merging.

The deterministic core does not call a hosted AI API. JSON graphs are authoritative;
SQLite is a rebuildable query index. Schema migrations are in-memory and conservative.
The dashboard and MCP server use the same public core APIs as the CLI.
