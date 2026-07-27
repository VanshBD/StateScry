import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createStateScryMcpServer } from "../src/index.js";

const temporaryRoots: string[] = [];
const appServers: Server[] = [];

afterEach(async () => {
  delete process.env.STATESCRY_PROJECT_ROOT;
  await Promise.all(
    appServers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolveClose) =>
            server.close(() => resolveClose()),
          ),
      ),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function textJson(result: { content?: unknown }): unknown {
  const content = result.content;
  if (!Array.isArray(content)) throw new Error("MCP result has no content.");
  const block = content[0] as { type?: string; text?: string } | undefined;
  if (block?.type !== "text" || typeof block.text !== "string")
    throw new Error("MCP result did not contain text JSON.");
  return JSON.parse(block.text);
}

async function startTestApp(): Promise<string> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://local.test").pathname;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      path === "/next"
        ? '<title>Next</title><h1>Next state</h1><a href="/">Home</a>'
        : '<title>Home</title><h1>Home</h1><a href="/next">Next</a>',
    );
  });
  appServers.push(server);
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("MCP test app did not bind a port.");
  return `http://127.0.0.1:${address.port}`;
}

describe("StateScry MCP server", () => {
  it("completes the protocol handshake and exposes the complete tool surface", async () => {
    const server = createStateScryMcpServer();
    const client = new Client({
      name: "statescry-test-client",
      version: "2.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).toSorted();

    expect(names).toEqual(
      [
        "analyze_run",
        "compare_role_access",
        "compare_runs",
        "coverage_history",
        "find_path_to_state",
        "get_state_evidence",
        "list_runs",
        "list_states",
        "map_application",
        "map_matrix",
        "replay_state",
      ].toSorted(),
    );

    await client.close();
    await server.close();
  });

  it("executes every major tool through MCP with compact verified results", async () => {
    const root = await mkdtemp(resolve(process.cwd(), ".tmp-statescry-mcp-"));
    temporaryRoots.push(root);
    process.env.STATESCRY_PROJECT_ROOT = root;
    const url = await startTestApp();
    const server = createStateScryMcpServer();
    const client = new Client({ name: "integration-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const targetBrowser = (process.env.STATESCRY_E2E_BROWSER || "chromium") as
      "chromium" | "firefox" | "webkit";

    const mapped = textJson(
      await client.callTool({
        name: "map_application",
        arguments: {
          url,
          name: "mcp-baseline",
          maxStates: 4,
          maxDepth: 2,
          browser: targetBrowser,
        },
      }),
    ) as { id: string; states: number; coverage: unknown };
    expect(mapped.states).toBeGreaterThanOrEqual(2);
    expect(mapped.coverage).toBeDefined();

    const runs = textJson(
      await client.callTool({ name: "list_runs", arguments: {} }),
    ) as Array<{ id: string }>;
    expect(runs.some((run) => run.id === mapped.id)).toBe(true);

    const states = textJson(
      await client.callTool({
        name: "list_states",
        arguments: { run: mapped.id, query: "Next" },
      }),
    ) as Array<{ id: string; heading: string }>;
    const nextState = states.find((state) => state.heading === "Next state");
    expect(nextState).toBeDefined();
    const stateId = nextState!.id;

    const path = textJson(
      await client.callTool({
        name: "find_path_to_state",
        arguments: { run: mapped.id, stateId },
      }),
    ) as { path: unknown[] };
    expect(path.path).toHaveLength(1);

    const replay = textJson(
      await client.callTool({
        name: "replay_state",
        arguments: { run: mapped.id, stateId },
      }),
    ) as { status: string; mismatches: unknown[] };
    expect(replay).toMatchObject({ status: "verified", mismatches: [] });

    const compared = textJson(
      await client.callTool({
        name: "compare_runs",
        arguments: { before: mapped.id, after: mapped.id },
      }),
    ) as { added: unknown[]; removed: unknown[] };
    expect(compared).toMatchObject({ added: [], removed: [] });

    const analysis = textJson(
      await client.callTool({
        name: "analyze_run",
        arguments: { run: mapped.id },
      }),
    ) as { reachability: { assessed: boolean } };
    expect(analysis.reachability.assessed).toBe(false);

    const access = textJson(
      await client.callTool({
        name: "compare_role_access",
        arguments: {
          lessPrivilegedRun: mapped.id,
          privilegedRun: mapped.id,
        },
      }),
    ) as { limitations: string[] };
    expect(access.limitations.length).toBeGreaterThan(0);

    const evidence = textJson(
      await client.callTool({
        name: "get_state_evidence",
        arguments: { run: mapped.id, stateId },
      }),
    ) as { stateId: string; evidence: unknown };
    expect(evidence).toMatchObject({ stateId });
    expect(evidence.evidence).toBeDefined();

    const matrix = textJson(
      await client.callTool({
        name: "map_matrix",
        arguments: {
          url,
          personas: ["default"],
          viewports: ["desktop"],
          workers: 1,
          maxStates: 4,
          maxDepth: 2,
        },
      }),
    ) as { cells: unknown[]; atlas: { nodes: number } };
    expect(matrix.cells).toHaveLength(1);
    expect(matrix.atlas.nodes).toBeGreaterThanOrEqual(2);

    const history = textJson(
      await client.callTool({ name: "coverage_history", arguments: {} }),
    ) as { points: unknown[]; limitations: string[] };
    expect(history.points.length).toBeGreaterThanOrEqual(2);
    expect(history.limitations[0]).toMatch(/measured/);

    await client.close();
    await server.close();
  }, 60_000);
});
