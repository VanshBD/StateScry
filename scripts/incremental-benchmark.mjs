import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  compareRuns,
  exploreApplication,
  replayState,
} from "../packages/core/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const qualityDirectory = resolve(root, ".statescry", "quality");
const projectRoot = await mkdtemp(
  join(tmpdir(), "statescry-incremental-benchmark-"),
);
let changedHeading = "Route 8";
let completedMutations = 0;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://local.test");
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (request.method === "POST") {
    completedMutations += 1;
    response.end("<h1>Mutation should have been blocked</h1>");
    return;
  }
  if (url.pathname === "/") {
    const links = Array.from(
      { length: 9 },
      (_, index) => `<a href="/route-${index}">Route ${index}</a>`,
    ).join("");
    response.end(`<title>Home</title><h1>Home</h1>${links}`);
    return;
  }
  const index = Number(url.pathname.replace("/route-", ""));
  const heading = index === 8 ? changedHeading : `Route ${index}`;
  response.end(
    `<title>${heading}</title><h1>${heading}</h1><a href="/">Home</a><form method="post" action="/mutate"><button type="submit">Save</button></form>`,
  );
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

function options() {
  return {
    baseUrl,
    projectRoot,
    browser: "chromium",
    headless: true,
    maxStates: 12,
    maxDepth: 2,
    maxActionsPerState: 20,
    actionTimeoutMs: 3_000,
    navigationTimeoutMs: 3_000,
    settleMs: 15,
    allowedOrigins: [baseUrl],
    explorationMode: "observe",
    mutationAllowlist: [],
    allowHooks: false,
    evidenceMode: "metadata",
    redactPatterns: [],
    ignoredTextPatterns: [],
    inputs: [],
    customActions: [],
    waitForSelectors: [],
    replayAssertions: [],
    persona: { name: "benchmark", role: "anonymous" },
    viewport: { name: "desktop", width: 1024, height: 768 },
    featureContext: { fixture: "incremental-leaf-change" },
    environment: "benchmark",
  };
}

try {
  const full = await exploreApplication(options());
  changedHeading = "Route 8 changed";
  const incrementalOptions = options();
  incrementalOptions.incremental = {
    priorRun: full,
    changes: {
      routes: ["/route-8"],
      reason: "benchmark leaf route changed",
    },
  };
  const incremental = await exploreApplication(incrementalOptions);
  const expectedPaths = new Set([
    "/",
    ...Array.from({ length: 9 }, (_, index) => `/route-${index}`),
  ]);
  const actualPaths = new Set(
    incremental.states.map((state) => new URL(state.url).pathname),
  );
  const discoveredExpected = [...expectedPaths].filter((path) =>
    actualPaths.has(path),
  ).length;
  const routeRecall = discoveredExpected / expectedPaths.size;
  const observedRatio =
    (incremental.stats.observedStates ?? incremental.states.length) /
    full.states.length;
  const diff = compareRuns(full, incremental);
  const changed = incremental.states.find(
    (state) => state.heading === "Route 8 changed",
  );
  assert(changed, "Incremental map did not observe the changed route.");
  const replay = await replayState(incremental, changed.id);
  const falsePositiveChanges = diff.changed.filter(
    (state) => !state.after.url.endsWith("/route-8"),
  ).length;

  assert.equal(routeRecall, 1, "Incremental run lost expected route coverage.");
  assert(
    observedRatio <= 0.2,
    "Incremental run repeated too much exploration.",
  );
  assert.equal(incremental.stats.reusedStates, 9);
  assert.equal(replay.status, "verified");
  assert.equal(falsePositiveChanges, 0);
  assert.equal(completedMutations, 0, "Observe mode completed a mutation.");
  assert(
    incremental.stats.durationMs < full.stats.durationMs,
    "Incremental exploration did not improve elapsed time on the labeled fixture.",
  );

  const evidence = {
    status: "passed",
    fixture: "ten-state leaf-change application",
    measuredAt: new Date().toISOString(),
    full: {
      durationMs: full.stats.durationMs,
      states: full.states.length,
      observedStates: full.stats.observedStates,
    },
    incremental: {
      durationMs: incremental.stats.durationMs,
      states: incremental.states.length,
      observedStates: incremental.stats.observedStates,
      reusedStates: incremental.stats.reusedStates,
      invalidationReasons: incremental.incremental?.invalidationReasons,
    },
    metrics: {
      routeRecall,
      observedWorkRatio: observedRatio,
      elapsedImprovementRatio:
        1 - incremental.stats.durationMs / full.stats.durationMs,
      replaySuccessRate: replay.status === "verified" ? 1 : 0,
      falsePositiveChanges,
      completedUnapprovedMutations: completedMutations,
    },
    scope:
      "This deterministic fixture measures a leaf-route change; it is not a universal performance or coverage claim.",
  };
  await mkdir(qualityDirectory, { recursive: true });
  await writeFile(
    resolve(qualityDirectory, "incremental-benchmark.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  await rm(projectRoot, { recursive: true, force: true });
}
