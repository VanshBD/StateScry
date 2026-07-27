# StateScry MCP server

This package exposes compact, safety-conscious StateScry mapping, query, replay, diff,
analysis, role comparison, and evidence tools over standard-input/output MCP.

```json
{
  "mcpServers": {
    "statescry": {
      "command": "statescry-mcp",
      "env": { "STATESCRY_PROJECT_ROOT": "/absolute/path/to/project" }
    }
  }
}
```

It uses the credential-free local deterministic core. Standard output is reserved for
protocol messages; diagnostics use standard error.
