#!/usr/bin/env node
import { startStateScryMcp } from "./index.js";

startStateScryMcp().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[statescry] MCP server failed: ${message}\n`);
  process.exitCode = 1;
});
