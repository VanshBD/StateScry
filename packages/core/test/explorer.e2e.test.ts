import { createServer, type Server } from "node:http";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  exploreApplication,
  replayState,
  type ExploreOptions,
} from "../src/index.js";

const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolveClose) =>
            server.close(() => resolveClose()),
          ),
      ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function app(html: (path: string) => string): Promise<string> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://local.test").pathname;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html(path));
  });
  servers.push(server);
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind a port.");
  return `http://127.0.0.1:${address.port}`;
}

async function options(baseUrl: string): Promise<ExploreOptions> {
  const projectRoot = await mkdtemp(join(tmpdir(), "statescry-e2e-"));
  roots.push(projectRoot);
  return {
    baseUrl,
    projectRoot,
    browser:
      (process.env.STATESCRY_E2E_BROWSER as
        "chromium" | "firefox" | "webkit" | undefined) ?? "chromium",
    headless: true,
    maxStates: 8,
    maxDepth: 3,
    maxActionsPerState: 20,
    actionTimeoutMs: 3_000,
    navigationTimeoutMs: 3_000,
    settleMs: 20,
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
    persona: { name: "test", role: "anonymous" },
    viewport: { name: "desktop", width: 1024, height: 768 },
    featureContext: {},
    environment: "test",
  };
}

describe("local browser exploration", () => {
  it("re-explores only a declared changed route and preserves honest provenance", async () => {
    let settingsHeading = "Settings";
    const baseUrl = await app((path) => {
      if (path === "/settings")
        return `<title>Settings</title><h1>${settingsHeading}</h1><a href=/>Home</a>`;
      if (path === "/about")
        return "<title>About</title><h1>About</h1><a href=/>Home</a>";
      return "<title>Home</title><h1>Home</h1><a id=settings href=/settings>Settings</a><a id=about href=/about>About</a>";
    });
    const fullOptions = await options(baseUrl);
    const prior = await exploreApplication(fullOptions);
    settingsHeading = "Settings updated";
    const incrementalOptions = await options(baseUrl);
    incrementalOptions.incremental = {
      priorRun: prior,
      changes: { routes: ["/settings"], reason: "settings UI changed" },
    };
    const incremental = await exploreApplication(incrementalOptions);

    expect(incremental.incremental).toMatchObject({
      mode: "incremental",
      priorRunId: prior.id,
      exploredSeedPaths: 1,
    });
    expect(incremental.stats.observedStates).toBe(1);
    expect(incremental.stats.reusedStates).toBe(2);
    expect(
      incremental.states.find((state) => state.heading === "Settings updated")
        ?.provenance,
    ).toMatchObject({ kind: "observed" });
    expect(
      incremental.states.find((state) => state.heading === "About")?.provenance,
    ).toMatchObject({ kind: "reused", sourceRunId: prior.id });

    const forcedOptions = await options(baseUrl);
    forcedOptions.incremental = {
      priorRun: prior,
      changes: { routes: ["/settings"] },
      forceFull: true,
    };
    const forced = await exploreApplication(forcedOptions);
    expect(forced.incremental).toMatchObject({
      mode: "full",
      forcedFull: true,
    });
    expect(forced.stats.reusedStates).toBe(0);
    expect(forced.stats.observedStates).toBeGreaterThanOrEqual(3);
  }, 45_000);

  it("uses optional versioned framework signals and falls back honestly", async () => {
    const baseUrl = await app(
      () =>
        '<title>Adapter</title><meta name="statescry-state" content="account-ready"><h1>Account</h1>',
    );
    const configured = await options(baseUrl);
    configured.frameworkAdapters = [
      { name: "dom-markers", version: 1 },
      { name: "next-data", version: 1 },
    ];
    const run = await exploreApplication(configured);
    expect(run.states[0]?.frameworkSignals).toEqual({
      "dom.state": "account-ready",
    });
    expect(run.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/next-data@1.*black-box/)]),
    );
  }, 30_000);

  it("loads reviewed extensions only with explicit enablement and preserves safety", async () => {
    const baseUrl = await app(
      () =>
        "<title>Invoices</title><h1>Invoices</h1><p>Invoice INV-123</p><button id=details onclick=\"document.body.dataset.open='yes'\">Details</button>",
    );
    const disabled = await options(baseUrl);
    const modulePath = resolve(disabled.projectRoot, "invoice-extension.mjs");
    await writeFile(
      modulePath,
      `export default {
  manifest: { schemaVersion: 1, apiVersion: 1, name: 'invoice-test', version: '1.0.0', capabilities: ['actions', 'redactors'] },
  actions: () => [{ name: 'Domain details', kind: 'click', selector: '#details', allowInObserveMode: true }],
  redactors: input => ({ text: input.text.replace(/INV-\\d+/g, '[invoice-id]') })
};\n`,
      "utf8",
    );
    disabled.extensionModules = [modulePath];
    const disabledRun = await exploreApplication(disabled);
    expect(disabledRun.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/not loaded.*explicit/i)]),
    );
    expect(disabledRun.states[0]?.textSample).toContain("INV-123");

    const enabled = await options(baseUrl);
    enabled.extensionModules = [modulePath];
    enabled.allowExtensions = true;
    const enabledRun = await exploreApplication(enabled);
    expect(enabledRun.states[0]?.textSample).toContain("[invoice-id]");
    expect(
      enabledRun.transitions.some((transition) =>
        transition.action.tag.startsWith("extension:invoice-test"),
      ),
    ).toBe(true);
    expect(enabledRun.options).toMatchObject({
      extensionsEnabled: true,
      extensions: ["invoice-test@1.0.0"],
    });
  }, 30_000);

  it("maps a second-page journey, blocks semantic POST forms, and verifies replay", async () => {
    let postCount = 0;
    let profileHeading = "Profile";
    const baseUrl = await app((path) => {
      if (path === "/api/order") {
        postCount += 1;
        return "<h1>unexpected mutation</h1>";
      }
      if (path === "/profile")
        return `<title>Profile</title><h1>${profileHeading}</h1><a href=/>Home</a>`;
      return "<title>Home</title><h1>Home</h1><a href=/profile>Profile</a><a href=https://example.com>External docs</a><form method=post action=/api/order><button type=submit>Continue</button></form>";
    });
    const safeOptions = await options(baseUrl);
    safeOptions.featureContext = {
      apiKey: "must-not-persist",
      release: "test",
    };
    const run = await exploreApplication(safeOptions);

    expect(run.states.map((state) => state.heading)).toEqual(
      expect.arrayContaining(["Home", "Profile"]),
    );
    expect(
      run.states
        .find((state) => state.heading === "Home")
        ?.blockedActions.map((action) => action.label),
    ).toContain("Continue");
    expect(
      run.states
        .find((state) => state.heading === "Home")
        ?.blockedActions.find((action) => action.label === "External docs")
        ?.blockedReason,
    ).toMatch(/allowedOrigins/);
    expect(postCount).toBe(0);
    expect(run.featureContext).toEqual({
      apiKey: "[REDACTED]",
      release: "test",
    });
    expect(run.states.every((state) => !state.evidence.screenshotPath)).toBe(
      true,
    );
    const profile = run.states.find((state) => state.heading === "Profile");
    expect(profile).toBeDefined();
    const verifiedReplay = await replayState(run, profile!.id, {
      assertions: [{ type: "heading", expected: "Profile" }],
    });
    expect(verifiedReplay.status).toBe("verified");
    profileHeading = "Changed profile";
    const failedReplay = await replayState(run, profile!.id, {
      assertions: [{ type: "heading", expected: "Profile" }],
    });
    expect(failedReplay.status).toBe("failed");
    expect(failedReplay.mismatches.map((mismatch) => mismatch.field)).toEqual(
      expect.arrayContaining(["fingerprint", "heading", "assertion"]),
    );
    expect(failedReplay.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "FINAL_STATE_MISMATCH" }),
      ]),
    );
    const qualityDirectory = resolve(process.cwd(), ".statescry", "quality");
    await mkdir(qualityDirectory, { recursive: true });
    await writeFile(
      resolve(qualityDirectory, `browser-${run.options.browser}.json`),
      `${JSON.stringify(
        {
          browser: run.options.browser,
          mappingTimeMs: run.stats.durationMs,
          states: run.stats.states,
          transitions: run.stats.transitions,
          replay: { attempts: 2, verified: 1, failed: 1 },
          safety: {
            mutationRequestsCompleted: postCount,
            blockedActions: run.stats.blockedActions,
          },
          behaviorDiffFixtures: [
            "normalized dynamic data does not create a false positive",
            "role and device contexts never cross-match",
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }, 30_000);

  it("represents a hash-route application as distinct replayable state", async () => {
    let buttonId = "settings";
    const baseUrl = await app(
      () =>
        `<title>Workspace</title><h1 id="heading">Overview</h1><button id="${buttonId}" onclick="location.hash='settings';document.querySelector('#heading').textContent='Settings'">Settings</button>`,
    );
    const run = await exploreApplication(await options(baseUrl));
    const settings = run.states.find((state) => state.heading === "Settings");
    expect(settings?.normalizedUrl).toContain("#settings");
    buttonId = "settings-renamed";
    const replay = await replayState(run, settings!.id);
    expect(replay.status).toBe("verified");
    expect(replay.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LOCATOR_FALLBACK_USED",
          severity: "warning",
        }),
      ]),
    );
  }, 30_000);

  it("executes configured form, keyboard, modal, and lifecycle actions", async () => {
    const baseUrl = await app(
      () =>
        "<title>Workflow</title><h1>Workflow</h1><input id=name aria-label=Name><select id=plan aria-label=Plan><option value=free>Free</option><option value=pro>Pro</option></select><input id=terms aria-label=Terms type=checkbox><button id=open onclick=\"document.querySelector('#dialog').hidden=false\">Open dialog</button><div id=dialog role=dialog hidden>Plan details</div><p id=status></p><script>addEventListener('keydown',event=>{if(event.key==='Enter')document.querySelector('#status').textContent='Keyboard complete'})</script>",
    );
    const configured = await options(baseUrl);
    configured.maxStates = 12;
    configured.evidenceMode = "screenshots";
    configured.inputs = [{ selector: "#name", value: "Ada" }];
    configured.customActions = [
      {
        name: "Select pro",
        kind: "select",
        selector: "#plan",
        value: "pro",
        allowInObserveMode: true,
      },
      {
        name: "Accept terms",
        kind: "check",
        selector: "#terms",
        allowInObserveMode: true,
      },
      {
        name: "Open dialog",
        kind: "click",
        selector: "#open",
        allowInObserveMode: true,
      },
      {
        name: "Complete by keyboard",
        kind: "press",
        key: "Enter",
        allowInObserveMode: true,
      },
    ];
    const marker = resolve(configured.projectRoot, "seed-marker.txt");
    configured.seedHook = {
      command: process.execPath,
      args: [
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'seeded')`,
      ],
    };
    configured.allowHooks = true;

    const run = await exploreApplication(configured);
    const kinds = new Set(
      run.transitions.map((transition) => transition.action.kind),
    );
    expect(kinds).toEqual(
      new Set(["fill", "select", "check", "click", "press"]),
    );
    await expect(access(marker)).resolves.toBeUndefined();
    expect(
      run.states.some((state) => state.textSample.includes("Plan details")),
    ).toBe(true);
    expect(
      run.states.some((state) =>
        state.textSample.includes("Keyboard complete"),
      ),
    ).toBe(true);
    expect(run.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/sensitive visual application data/),
      ]),
    );
    expect(run.states.some((state) => state.evidence.screenshotPath)).toBe(
      true,
    );
  }, 30_000);

  it("captures configured loading and error states honestly", async () => {
    const baseUrl = await app(
      () =>
        "<title>Status</title><h1>Status</h1><button id=load onclick=\"document.querySelector('#status').textContent='Loading records'\">Load</button><button id=error onclick=\"document.querySelector('#status').textContent='Error loading records'\">Error</button><p id=status>Ready</p>",
    );
    const configured = await options(baseUrl);
    configured.customActions = [
      {
        name: "Loading state",
        kind: "click",
        selector: "#load",
        allowInObserveMode: true,
      },
      {
        name: "Error state",
        kind: "click",
        selector: "#error",
        allowInObserveMode: true,
      },
    ];
    const run = await exploreApplication(configured);
    expect(
      run.states.some((state) => state.textSample.includes("Loading records")),
    ).toBe(true);
    expect(
      run.states.some((state) =>
        state.textSample.includes("Error loading records"),
      ),
    ).toBe(true);
  }, 30_000);

  it("enforces state, depth, and action budgets with honest coverage status", async () => {
    const baseUrl = await app(
      () =>
        "<title>Budget</title><h1>Budget</h1><a href=/one>One</a><a href=/two>Two</a><a href=/three>Three</a>",
    );
    const configured = await options(baseUrl);
    configured.maxStates = 1;
    configured.maxDepth = 1;
    configured.maxActionsPerState = 1;
    const run = await exploreApplication(configured);

    expect(run.stats.truncated).toBe(true);
    expect(run.stats.coverage.budgetLimited).toBe(true);
    expect(run.states[0]).toMatchObject({
      outgoingActionCount: 1,
      coverageStatus: "budget_limited",
    });
    expect(run.stats.coverage.statement).toMatch(/not complete coverage/);
  }, 30_000);
});
