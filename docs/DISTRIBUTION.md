# Distribution and verification

## Repository installation

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm statescry init
```

`pnpm release:source-smoke` copies only source inputs into a clean directory, performs a
frozen install/build, launches the production sample, maps, verifies replay, writes a
report, and initializes MCP.

## Package installation

The release contains exact-version tarballs for SDK, core, MCP, and CLI. Before public
publishing, local tarball overrides are used only so unpublished inter-package names
resolve to those exact artifacts. `pnpm release:smoke` verifies no `workspace:` reference
remains and tests imports, CLI initialization, and MCP from installed files.

`pnpm release:build` creates checksums, CycloneDX SBOM, and local provenance. The hosted
release workflow adds GitHub OIDC provenance attestation. Publishing remains disabled
until StateScry trademark and package/repository ownership are confirmed.
