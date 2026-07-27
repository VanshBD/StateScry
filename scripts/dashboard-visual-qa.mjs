import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

import { chromium } from "../packages/core/node_modules/playwright/index.mjs";

const root = resolve(import.meta.dirname, "..");
const publicDirectory = resolve(root, "apps", "dashboard", "dist");
const qualityDirectory = resolve(root, ".statescry", "quality");

const viewport = { name: "desktop", width: 1440, height: 900 };
const persona = { name: "customer", role: "customer" };
const action = {
  id: "open-checkout",
  kind: "click",
  selector: "a[href='/checkout']",
  label: "Open checkout",
  tag: "a",
  risk: "safe",
};

function state(id, heading, path, depth, overrides = {}) {
  return {
    id,
    fingerprint: `fingerprint-${id}`,
    logicalKey: `${path}|customer|desktop`,
    url: `http://store.example${path}`,
    normalizedUrl: `http://store.example${path}`,
    title: `${heading} - Acme Store`,
    heading,
    textSample: `${heading} customer workflow`,
    accessibilitySnapshot: `- heading "${heading}"`,
    persona: "customer",
    role: "customer",
    viewport,
    featureContext: { checkout: "candidate" },
    depth,
    path: depth === 0 ? [] : [{ action }],
    discoveredAt: "2026-07-26T08:00:00.000Z",
    evidence: {
      screenshotPath: `screens/${id}.svg`,
      accessibilityPath: `accessibility/${id}.yaml`,
      console: [],
      networkFailures: [],
      blockedRequests: [],
      httpErrors: [],
    },
    outgoingActionCount: depth === 0 ? 2 : 0,
    blockedActions: [],
    coverageStatus: depth === 0 ? "explored" : "terminal",
    ...overrides,
  };
}

function run(id, name, states, overrides = {}) {
  return {
    schemaVersion: 2,
    id,
    name,
    projectName: "acme-store",
    projectRoot: "[local project]",
    baseUrl: "http://store.example",
    startedAt: "2026-07-26T08:00:00.000Z",
    completedAt: "2026-07-26T08:00:02.000Z",
    environment: "preview",
    persona,
    viewport,
    featureContext: { checkout: "candidate" },
    options: {
      browser: "chromium",
      maxStates: 25,
      maxDepth: 5,
      maxActionsPerState: 20,
      allowedOrigins: ["http://store.example"],
      explorationMode: "observe",
      mutationAllowlist: [],
      evidenceMode: "screenshot",
    },
    states,
    transitions: states.slice(1).map((target, index) => ({
      id: `transition-${index}`,
      source: states[0].id,
      target: target.id,
      action: {
        ...action,
        id: `action-${index}`,
        label: `Open ${target.heading}`,
      },
      discoveredAt: "2026-07-26T08:00:01.000Z",
    })),
    warnings: ["Screenshot evidence may contain visible application data."],
    stats: {
      states: states.length,
      transitions: Math.max(0, states.length - 1),
      blockedActions: 1,
      durationMs: 2017,
      truncated: false,
      errors: 0,
      coverage: {
        queuedPaths: 3,
        exploredPaths: 3,
        policyBlockedActions: 1,
        repeatedActionsSkipped: 0,
        depthLimitedStates: 0,
        budgetLimited: false,
        executionFailures: 0,
        statement:
          "Observed coverage is partial because one mutating action was blocked by policy.",
      },
    },
    ...overrides,
  };
}

const currentStates = [
  state("current-home", "Storefront", "/", 0),
  state("current-checkout", "Checkout", "/checkout", 1),
  state("current-settings", "Account settings", "/settings", 1, {
    textSample: "Account settings API keys",
  }),
];
const baselineStates = [
  state("baseline-home", "Storefront", "/", 0),
  state("baseline-checkout", "Checkout", "/checkout", 1),
];
const currentRun = run("current", "checkout-candidate", currentStates);
currentRun.incremental = {
  mode: "incremental",
  priorRunId: "baseline",
  declaredChanges: { routes: ["/settings"] },
  invalidationReasons: ["Declared route /settings matched one state."],
  invalidatedStateIds: ["baseline-settings"],
  reusedStateIds: ["current-home", "current-checkout"],
  exploredSeedPaths: 1,
  forcedFull: false,
};
currentRun.stats.observedStates = 1;
currentRun.stats.reusedStates = 2;
currentRun.options.frameworkAdapters = [{ name: "dom-markers", version: 1 }];
const baselineRun = run("baseline", "main-baseline", baselineStates, {
  featureContext: { checkout: "baseline" },
});

function summary(value) {
  return {
    id: value.id,
    name: value.name,
    projectName: value.projectName,
    baseUrl: value.baseUrl,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    role: value.persona.role,
    viewport: value.viewport.name,
    states: value.states.length,
    transitions: value.transitions.length,
    truncated: value.stats.truncated,
  };
}

function stateSummary(value) {
  return {
    id: value.id,
    url: value.url,
    title: value.title,
    heading: value.heading,
    role: value.role,
    viewport: value.viewport.name,
    depth: value.depth,
    coverageStatus: value.coverageStatus,
  };
}

const analysis = {
  runId: currentRun.id,
  terminalStates: currentStates.slice(1).map(stateSummary),
  limitedStates: [],
  reachability: {
    assessed: false,
    reason: "A black-box crawl cannot prove a state is unreachable.",
  },
  cycles: [],
  permissionRisks: [
    {
      stateId: "current-settings",
      role: "customer",
      label: "API keys",
      reason: "Review this observed privileged-looking UI.",
    },
  ],
  blockedActions: [],
};

const diff = {
  before: summary(baselineRun),
  after: summary(currentRun),
  matches: [
    {
      beforeStateId: "baseline-home",
      afterStateId: "current-home",
      confidence: 1,
      method: "stable_route",
      explanation: ["Normalized route and visible structure matched."],
    },
    {
      beforeStateId: "baseline-checkout",
      afterStateId: "current-checkout",
      confidence: 0.96,
      method: "stable_route",
      explanation: ["Normalized route and primary heading matched."],
    },
  ],
  added: [stateSummary(currentStates[2])],
  removed: [],
  changed: [
    {
      logicalKey: currentStates[1].logicalKey,
      before: stateSummary(baselineStates[1]),
      after: stateSummary(currentStates[1]),
      reasons: ["available actions changed"],
      confidence: 0.96,
      explanation: ["Normalized route and primary heading matched."],
    },
  ],
  journeys: [],
  reachability: { assessed: false, reason: "Reachability not assessed." },
  riskSignals: [],
};

const access = {
  lessPrivilegedRun: summary(baselineRun),
  privilegedRun: summary(currentRun),
  sharedStates: [],
  suspiciousExposure: analysis.permissionRisks,
  privilegedOnly: [stateSummary(currentStates[2])],
  limitations: ["Observed UI access is not proof of server authorization."],
};

function json(response, value, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function screenshotSvg(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="#0b1019"/><rect x="48" y="44" width="864" height="76" rx="12" fill="#151e2d"/><circle cx="86" cy="82" r="16" fill="${color}"/><text x="118" y="92" fill="#f8fafc" font-family="Arial" font-size="28">${label}</text><rect x="48" y="154" width="540" height="392" rx="14" fill="#101722"/><rect x="620" y="154" width="292" height="180" rx="14" fill="#101722"/><rect x="620" y="366" width="292" height="180" rx="14" fill="#101722"/></svg>`;
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function inside(rootDirectory, candidate) {
  return (
    candidate === rootDirectory ||
    candidate.startsWith(`${rootDirectory}${sep}`)
  );
}

async function serveStatic(response, pathname) {
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(publicDirectory, relative);
  if (!inside(publicDirectory, candidate)) return false;
  try {
    if (!(await stat(candidate)).isFile()) return false;
    response.writeHead(200, {
      "content-type":
        contentTypes[extname(candidate)] ?? "application/octet-stream",
    });
    createReadStream(candidate).pipe(response);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/runs")
    return json(response, [summary(currentRun), summary(baselineRun)]);
  if (url.pathname === "/api/history")
    return json(response, {
      points: [],
      measuredTrend: {
        stateDelta: 1,
        transitionDelta: 1,
        durationDeltaMs: -800,
      },
      estimatedRecommendations: [],
      limitations: [],
    });
  if (url.pathname === "/api/runs/current") return json(response, currentRun);
  if (url.pathname === "/api/runs/baseline") return json(response, baselineRun);
  if (url.pathname.endsWith("/analysis")) return json(response, analysis);
  if (url.pathname === "/api/diff") return json(response, diff);
  if (url.pathname === "/api/access") return json(response, access);
  if (url.pathname === "/api/replay") {
    return json(response, {
      status: "verified",
      requestedStateId: url.searchParams.get("state"),
      requestedUrl: "http://store.example/checkout",
      finalUrl: "http://store.example/checkout",
      title: "Checkout - Acme Store",
      heading: "Checkout",
      fingerprint: "fingerprint-current-checkout",
      steps: 1,
      mismatches: [],
    });
  }
  if (url.pathname.startsWith("/api/artifacts/")) {
    const label = url.pathname.includes("baseline")
      ? "Baseline evidence"
      : "Candidate evidence";
    response.writeHead(200, { "content-type": "image/svg+xml" });
    return response.end(
      screenshotSvg(
        label,
        label.startsWith("Baseline") ? "#f59e0b" : "#22c55e",
      ),
    );
  }
  if (await serveStatic(response, url.pathname)) return;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(await readFile(resolve(publicDirectory, "index.html")));
});

await mkdir(qualityDirectory, { recursive: true });
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
assert(
  address && typeof address === "object",
  "Visual QA server did not bind.",
);
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const runtimeErrors = [];

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) =>
    runtimeErrors.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      runtimeErrors.push(`console: ${message.text()}`);
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "checkout-candidate" }).waitFor();
  await page.getByText("Partial coverage").waitFor();
  await page.getByText("Incremental map").waitFor();
  await page.getByRole("navigation", { name: "Graph states" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Checkout/ }).count(), 1);

  await page.getByLabel("Compare this run against").selectOption("baseline");
  await page.getByText(/1 added/).waitFor();
  await page.getByRole("button", { name: /Checkout/ }).click();
  await page.getByRole("complementary", { name: "State evidence" }).waitFor();
  await page.getByRole("button", { name: "Replay this state" }).click();
  await page.getByText("Verified", { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(qualityDirectory, "dashboard-desktop.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByLabel("Search states").fill("settings");
  await page.getByText("1/3", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Account settings/ }).count(),
    1,
  );
  const desktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(
    desktopOverflow <= 1,
    `Desktop layout overflows horizontally by ${desktopOverflow}px.`,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Checkout/ }).click();
  await page.getByRole("complementary", { name: "State evidence" }).waitFor();
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(
    mobileOverflow <= 1,
    `Mobile layout overflows horizontally by ${mobileOverflow}px.`,
  );
  await page.screenshot({
    path: resolve(qualityDirectory, "dashboard-mobile.png"),
    fullPage: true,
  });

  assert.deepEqual(runtimeErrors, [], runtimeErrors.join("\n"));
  await writeFile(
    resolve(qualityDirectory, "dashboard-visual-qa.json"),
    `${JSON.stringify(
      {
        status: "passed",
        reviewedAt: new Date().toISOString(),
        productionBundle: "apps/dashboard/dist",
        viewports: [
          {
            name: "desktop",
            width: 1440,
            height: 1000,
            horizontalOverflowPx: desktopOverflow,
          },
          {
            name: "mobile",
            width: 390,
            height: 844,
            horizontalOverflowPx: mobileOverflow,
          },
        ],
        exercised: [
          "coverage warnings",
          "behavior comparison",
          "state filtering",
          "keyboard-accessible state selection",
          "evidence inspector",
          "side-by-side visual evidence",
          "verified replay status",
          "incremental provenance and measured history",
        ],
        runtimeErrors,
        screenshots: ["dashboard-desktop.png", "dashboard-mobile.png"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log("Dashboard visual QA passed at desktop and mobile viewports.");
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}
