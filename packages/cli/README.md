# StateScry CLI

Build the command line and map a local development application:

From this repository:

```bash
pnpm statescry init http://127.0.0.1:3000
pnpm statescry map http://127.0.0.1:3000 --name baseline
pnpm statescry show
```

After installing the package from a published or local artifact, use the same commands
without the `pnpm` prefix.

The package also includes Playwright journey import, incremental mapping, parallel and
resumable persona/device matrices, verified replay, benchmarks, PR reports, coverage
history, extension validation, and the MCP entry point. Local deterministic use needs
no credentials.
