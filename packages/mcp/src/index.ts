import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  analyzeRun,
  calculateCoverageHistory,
  compareRoleAccess,
  compareRuns,
  exploreApplication,
  listRuns,
  loadRun,
  replayState,
  resolveExploreOptions,
  runMappingMatrix,
  shortestPath,
  summarizeRun,
} from "@statescry-tool/core";
import { z } from "zod";

function text(value: unknown) {
  const serialized = JSON.stringify(value);
  const safeSerialized =
    serialized.length > 24_000
      ? JSON.stringify({
          truncated: true,
          totalCharacters: serialized.length,
          preview: serialized.slice(0, 22_000),
          guidance:
            "Narrow the query or lower its limit to retrieve a complete response.",
        })
      : serialized;
  return {
    content: [
      {
        type: "text" as const,
        text: safeSerialized,
      },
    ],
  };
}

function compactRun(run: import("@statescry-tool/core").BehaviorRun) {
  return {
    id: run.id,
    name: run.name,
    role: run.persona.role,
    viewport: run.viewport.name,
    states: run.states.length,
    transitions: run.transitions.length,
    truncated: run.stats.truncated,
    coverage: run.stats.coverage,
    warnings: run.warnings.slice(-10),
    mode: run.incremental?.mode ?? "full",
    observedStates: run.stats.observedStates ?? run.states.length,
    reusedStates: run.stats.reusedStates ?? 0,
  };
}

function projectRoot(): string {
  return resolve(process.env.STATESCRY_PROJECT_ROOT ?? process.cwd());
}

export function createStateScryMcpServer(): McpServer {
  const server = new McpServer({
    name: "statescry",
    version: "2.0.0",
  });

  server.registerTool(
    "map_application",
    {
      title: "Map application behavior",
      description:
        "Explore a web application and save a persistent graph of meaningful UI states, safe actions, replay paths, and evidence.",
      inputSchema: {
        url: z.string().url(),
        name: z.string().min(1).optional(),
        browser: z.enum(["chromium", "firefox", "webkit"]).optional(),
        persona: z.string().min(1).default("default"),
        role: z.string().min(1).default("anonymous"),
        storageStatePath: z.string().optional(),
        viewport: z.enum(["desktop", "tablet", "mobile"]).default("desktop"),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        maxStates: z.number().int().min(1).max(1_000).default(100),
        maxDepth: z.number().int().min(0).max(30).default(8),
        evidenceMode: z
          .enum(["metadata", "screenshots", "full"])
          .default("metadata"),
        explorationMode: z.enum(["observe", "allowlist"]).default("observe"),
        environment: z.string().default("local"),
        featureContext: z.record(z.string()).default({}),
        incrementalFrom: z.string().min(1).optional(),
        changedRoutes: z.array(z.string()).default([]),
        changedSelectors: z.array(z.string()).default([]),
        changedFiles: z.array(z.string()).default([]),
        changeReason: z.string().optional(),
        forceFull: z.boolean().default(false),
      },
    },
    async (input) => {
      try {
        const options = await resolveExploreOptions({
          baseUrl: input.url,
          projectRoot: projectRoot(),
          ...(input.name ? { name: input.name } : {}),
          ...(input.browser ? { browser: input.browser } : {}),
          persona: input.persona,
          role: input.role,
          ...(input.storageStatePath
            ? { storageStatePath: input.storageStatePath }
            : {}),
          viewport: input.viewport,
          ...(input.width ? { width: input.width } : {}),
          ...(input.height ? { height: input.height } : {}),
          maxStates: input.maxStates,
          maxDepth: input.maxDepth,
          evidenceMode: input.evidenceMode,
          explorationMode: input.explorationMode,
          environment: input.environment,
          featureContext: input.featureContext,
        });
        if (input.incrementalFrom) {
          options.incremental = {
            priorRun: await loadRun(projectRoot(), input.incrementalFrom),
            changes: {
              ...(input.changedRoutes.length > 0
                ? { routes: input.changedRoutes }
                : {}),
              ...(input.changedSelectors.length > 0
                ? { selectors: input.changedSelectors }
                : {}),
              ...(input.changedFiles.length > 0
                ? { files: input.changedFiles }
                : {}),
              ...(input.changeReason ? { reason: input.changeReason } : {}),
            },
            ...(input.forceFull ? { forceFull: true } : {}),
          };
        } else if (input.forceFull) {
          throw new Error("forceFull requires incrementalFrom.");
        }
        const run = await exploreApplication(options, (progress) => {
          process.stderr.write(`[statescry] ${progress.message}\n`);
        });
        return text(compactRun(run));
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "map_matrix",
    {
      title: "Map persona and viewport matrix",
      description:
        "Map a bounded set of configured personas and viewports with safe parallel workers, checkpoints, isolated evidence, and deterministic atlas IDs. Extensions and hooks are not enabled through MCP.",
      inputSchema: {
        url: z.string().url(),
        browser: z.enum(["chromium", "firefox", "webkit"]).optional(),
        personas: z.array(z.string().min(1)).min(1).max(5),
        viewports: z
          .array(z.enum(["desktop", "tablet", "mobile"]))
          .min(1)
          .max(3),
        workers: z.number().int().min(1).max(4).default(2),
        maxStates: z.number().int().min(1).max(200).default(50),
        maxDepth: z.number().int().min(0).max(20).default(6),
        resume: z.boolean().default(false),
      },
    },
    async (input) => {
      try {
        const cells = [];
        for (const persona of input.personas)
          for (const viewport of input.viewports)
            cells.push({
              key: `${persona}-${viewport}`,
              options: await resolveExploreOptions({
                baseUrl: input.url,
                projectRoot: projectRoot(),
                ...(input.browser ? { browser: input.browser } : {}),
                persona,
                viewport,
                maxStates: input.maxStates,
                maxDepth: input.maxDepth,
                name: `${persona}-${viewport}`,
              }),
            });
        const result = await runMappingMatrix(cells, {
          projectRoot: projectRoot(),
          maxWorkers: input.workers,
          resume: input.resume,
        });
        return text({
          sessionId: result.sessionId,
          checkpointPath: ".statescry/sessions/[session].json",
          cells: result.runs.map(({ key, run }) => ({
            key,
            ...compactRun(run),
          })),
          atlas: {
            nodes: result.atlas.nodes.length,
            edges: result.atlas.edges.length,
          },
          resumedCells: result.resumedCells,
        });
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "coverage_history",
    {
      title: "Coverage history",
      description:
        "Return measured saved-run coverage trends separately from labeled budget estimates.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    },
    async ({ limit }) => {
      try {
        const summaries = (await listRuns(projectRoot())).slice(0, limit);
        const runs = await Promise.all(
          summaries.map((summary) => loadRun(projectRoot(), summary.id)),
        );
        return text(calculateCoverageHistory(runs));
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "list_runs",
    {
      title: "List behavior runs",
      description:
        "List saved StateScry runs with persona, viewport, state, and transition counts.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await listRuns(projectRoot()));
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "list_states",
    {
      title: "List or search states",
      description:
        "Find states in a behavior run by URL, heading, title, or visible text.",
      inputSchema: {
        run: z.string().min(1),
        query: z.string().default(""),
        limit: z.number().int().min(1).max(500).default(100),
      },
    },
    async ({ run: runId, query, limit }) => {
      try {
        const run = await loadRun(projectRoot(), runId);
        const needle = query.toLowerCase();
        return text(
          run.states
            .filter((state) =>
              `${state.url} ${state.title} ${state.heading} ${state.textSample}`
                .toLowerCase()
                .includes(needle),
            )
            .slice(0, limit)
            .map((state) => ({
              id: state.id,
              url: state.url,
              title: state.title,
              heading: state.heading,
              role: state.role,
              viewport: state.viewport.name,
              depth: state.depth,
              coverageStatus: state.coverageStatus,
            })),
        );
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "find_path_to_state",
    {
      title: "Find path to state",
      description:
        "Return the shortest discovered, replayable action sequence leading to a state.",
      inputSchema: {
        run: z.string().min(1),
        stateId: z.string().min(1),
      },
    },
    async ({ run: runId, stateId }) => {
      try {
        const run = await loadRun(projectRoot(), runId);
        return text({
          runId: run.id,
          stateId,
          path: shortestPath(run, stateId),
        });
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "replay_state",
    {
      title: "Replay state",
      description:
        "Reproduce a discovered state in a fresh browser and capture current screenshot evidence.",
      inputSchema: {
        run: z.string().min(1),
        stateId: z.string().min(1),
        headed: z.boolean().default(false),
      },
    },
    async ({ run: runId, stateId, headed }) => {
      try {
        const run = await loadRun(projectRoot(), runId);
        const result = await replayState(run, stateId, { headless: !headed });
        return text({
          status: result.status,
          requestedStateId: result.requestedStateId,
          finalUrl: result.finalUrl,
          title: result.title,
          heading: result.heading,
          steps: result.steps,
          mismatches: result.mismatches,
          diagnostics: result.diagnostics,
          evidenceAvailable: Boolean(result.evidence),
        });
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "compare_runs",
    {
      title: "Compare application behavior",
      description:
        "Compare two behavior runs and report states and journeys that were added, removed, changed, or made risky.",
      inputSchema: {
        before: z.string().min(1),
        after: z.string().min(1),
      },
    },
    async ({ before, after }) => {
      try {
        const [beforeRun, afterRun] = await Promise.all([
          loadRun(projectRoot(), before),
          loadRun(projectRoot(), after),
        ]);
        return text(compareRuns(beforeRun, afterRun));
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "analyze_run",
    {
      title: "Analyze behavior graph",
      description:
        "Report evidence-qualified terminal states, exploration limits, cycles, blocked actions, and probable permission risks. It does not claim black-box states are unreachable.",
      inputSchema: { run: z.string().min(1) },
    },
    async ({ run: runId }) => {
      try {
        return text(analyzeRun(await loadRun(projectRoot(), runId)));
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "compare_role_access",
    {
      title: "Compare role access",
      description:
        "Compare less-privileged and privileged persona runs to identify shared, privileged-only, and suspiciously exposed states.",
      inputSchema: {
        lessPrivilegedRun: z.string().min(1),
        privilegedRun: z.string().min(1),
      },
    },
    async ({ lessPrivilegedRun, privilegedRun }) => {
      try {
        const [less, privileged] = await Promise.all([
          loadRun(projectRoot(), lessPrivilegedRun),
          loadRun(projectRoot(), privilegedRun),
        ]);
        return text(compareRoleAccess(less, privileged));
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "get_state_evidence",
    {
      title: "Get state evidence",
      description:
        "Retrieve the stored screenshot, accessibility, trace, console, network, context, and replay metadata for one state.",
      inputSchema: {
        run: z.string().min(1),
        stateId: z.string().min(1),
      },
    },
    async ({ run: runId, stateId }) => {
      try {
        const run = await loadRun(projectRoot(), runId);
        const state = run.states.find((candidate) => candidate.id === stateId);
        return text(
          state
            ? {
                runId: run.id,
                stateId: state.id,
                url: state.url,
                title: state.title,
                heading: state.heading,
                persona: state.persona,
                role: state.role,
                viewport: state.viewport,
                featureContext: state.featureContext,
                path: shortestPath(run, state.id),
                evidence: state.evidence,
              }
            : { error: `State ${stateId} was not found in ${run.id}.` },
        );
      } catch (error) {
        return text({
          isError: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  return server;
}

export async function startStateScryMcp(): Promise<void> {
  const server = createStateScryMcpServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[statescry] MCP server ready for ${projectRoot()}\n`);
}
