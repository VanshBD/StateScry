import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  calculateCoverageHistory,
  runMappingMatrix,
  saveRun,
  type ExploreOptions,
  type MatrixCell,
} from "../src/index.js";
import { run, state } from "./fixtures.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function options(projectRoot: string, persona: string): ExploreOptions {
  return {
    baseUrl: "http://example.test",
    projectRoot,
    name: persona,
    browser: "chromium",
    headless: true,
    maxStates: 10,
    maxDepth: 4,
    maxActionsPerState: 10,
    actionTimeoutMs: 1_000,
    navigationTimeoutMs: 1_000,
    settleMs: 10,
    allowedOrigins: ["http://example.test"],
    explorationMode: "observe",
    mutationAllowlist: [],
    allowHooks: true,
    seedHook: {
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
    evidenceMode: "metadata",
    redactPatterns: [],
    ignoredTextPatterns: [],
    inputs: [],
    customActions: [],
    waitForSelectors: [],
    replayAssertions: [],
    persona: { name: persona, role: persona },
    viewport: { name: "desktop", width: 1440, height: 900 },
    featureContext: {},
    environment: "test",
    frameworkAdapters: [],
  };
}

describe("coordinated mapping scale", () => {
  it("runs isolated cells concurrently, checkpoints, merges deterministically, and resumes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "statescry-matrix-"));
    roots.push(projectRoot);
    const cells: MatrixCell[] = [
      { key: "customer-desktop", options: options(projectRoot, "customer") },
      { key: "admin-desktop", options: options(projectRoot, "admin") },
    ];
    let active = 0;
    let peak = 0;
    const runner = async (input: ExploreOptions) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      active -= 1;
      const behavior = run(
        [
          state(`${input.persona.name}-home`, `${input.persona.name}-home`, 0, {
            role: input.persona.role,
            persona: input.persona.name,
          }),
        ],
        [],
        {
          id: `run-${input.persona.name}`,
          name: input.persona.name,
          projectRoot,
          persona: input.persona,
        },
      );
      await saveRun(behavior);
      return behavior;
    };
    const first = await runMappingMatrix(cells, {
      projectRoot,
      maxWorkers: 2,
      runner,
    });
    expect(peak).toBe(2);
    expect(first.executedCells).toEqual(["admin-desktop", "customer-desktop"]);
    expect(first.sharedSeedHookRuns).toBe(1);
    expect(first.atlas.nodes.map((node) => node.id)).toEqual([
      "admin-desktop:admin-home",
      "customer-desktop:customer-home",
    ]);
    const checkpoint = JSON.parse(
      await readFile(first.checkpointPath, "utf8"),
    ) as { cells: unknown[] };
    expect(checkpoint.cells).toHaveLength(2);

    const resumed = await runMappingMatrix(cells, {
      projectRoot,
      maxWorkers: 2,
      resume: true,
      runner: async () => {
        throw new Error("completed cells must not rerun");
      },
    });
    expect(resumed.resumedCells).toEqual(["admin-desktop", "customer-desktop"]);
    expect(resumed.executedCells).toEqual([]);
  });

  it("keeps measured history separate from estimated recommendations", () => {
    const first = run([state("one", "one", 0)], [], {
      id: "first",
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = run([state("one", "one", 0), state("two", "two", 1)], [], {
      id: "second",
      completedAt: "2026-01-02T00:00:00.000Z",
      stats: {
        states: 2,
        transitions: 0,
        blockedActions: 1,
        durationMs: 2_000,
        truncated: true,
        errors: 1,
        coverage: {
          queuedPaths: 2,
          exploredPaths: 1,
          policyBlockedActions: 1,
          repeatedActionsSkipped: 0,
          depthLimitedStates: 0,
          budgetLimited: true,
          executionFailures: 1,
          statement: "partial",
        },
      },
    });
    const history = calculateCoverageHistory([second, first]);
    expect(history.measuredTrend).toMatchObject({
      stateDelta: 1,
      durationDeltaMs: 1_000,
    });
    expect(history.estimatedRecommendations).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Estimate:/)]),
    );
    expect(history.limitations[0]).toMatch(/measured.*estimates/);
  });
});
