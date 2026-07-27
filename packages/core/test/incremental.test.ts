import { describe, expect, it } from "vitest";

import {
  planIncrementalExploration,
  type ExploreOptions,
} from "../src/index.js";
import { run, state, transition } from "./fixtures.js";

function options(): ExploreOptions {
  return {
    baseUrl: "http://example.test",
    projectRoot: process.cwd(),
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
    allowHooks: false,
    evidenceMode: "metadata",
    redactPatterns: [],
    ignoredTextPatterns: [],
    inputs: [],
    customActions: [],
    waitForSelectors: [],
    replayAssertions: [],
    persona: { name: "customer", role: "customer" },
    viewport: { name: "desktop", width: 1440, height: 900 },
    featureContext: {},
    environment: "test",
    frameworkAdapters: [],
  };
}

describe("incremental exploration planning", () => {
  it("reuses unaffected states and expands invalidation through descendants", () => {
    const root = state("home", "home", 0, {
      url: "http://example.test/",
      normalizedUrl: "http://example.test/",
      path: [],
    });
    const settings = state("settings", "settings", 1, {
      url: "http://example.test/settings",
      normalizedUrl: "http://example.test/settings",
    });
    const detail = state("detail", "detail", 2, {
      url: "http://example.test/settings/detail",
      normalizedUrl: "http://example.test/settings/detail",
      path: [
        settings.path[0]!,
        { ...settings.path[0]!, sourceStateId: "settings" },
      ],
    });
    const about = state("about", "about", 1, {
      url: "http://example.test/about",
      normalizedUrl: "http://example.test/about",
    });
    const prior = run(
      [root, settings, detail, about],
      [
        transition("home-settings", "home", "settings"),
        transition("settings-detail", "settings", "detail"),
        transition("home-about", "home", "about"),
      ],
      {
        baseUrl: "http://example.test",
        options: {
          browser: "chromium",
          maxStates: 10,
          maxDepth: 4,
          maxActionsPerState: 10,
          allowedOrigins: ["http://example.test"],
          explorationMode: "observe",
          mutationAllowlist: [],
          evidenceMode: "metadata",
        },
      },
    );

    const plan = planIncrementalExploration(prior, options(), {
      routes: ["/settings"],
    });
    expect(plan.mode).toBe("incremental");
    expect(plan.invalidatedStateIds).toEqual(["detail", "settings"]);
    expect(plan.reusedStateIds).toEqual(["about", "home"]);
    expect(plan.seedPaths).toHaveLength(1);
  });

  it("falls back to full mapping when scope compatibility or change mapping is unknown", () => {
    const prior = run([state("home", "home", 0)], [], {
      baseUrl: "http://example.test",
      options: {
        browser: "chromium",
        maxStates: 10,
        maxDepth: 4,
        maxActionsPerState: 10,
        allowedOrigins: ["http://example.test"],
        explorationMode: "observe",
        mutationAllowlist: [],
        evidenceMode: "metadata",
      },
    });
    const changedRole = options();
    changedRole.persona = { name: "admin", role: "admin" };
    expect(
      planIncrementalExploration(prior, changedRole, { routes: ["/"] }),
    ).toMatchObject({ mode: "full", reusedStateIds: [] });
    expect(
      planIncrementalExploration(prior, options(), { files: ["src/util.ts"] }),
    ).toMatchObject({ mode: "full", reusedStateIds: [] });
  });
});
