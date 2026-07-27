import type {
  ActionDescriptor,
  BehaviorRun,
  StateNode,
  Transition,
} from "../src/index.js";

export const action: ActionDescriptor = {
  id: "action_next",
  kind: "click",
  selector: "#next",
  label: "Next",
  tag: "button",
  risk: "safe",
};

export function state(
  id: string,
  logicalKey: string,
  depth: number,
  overrides: Partial<StateNode> = {},
): StateNode {
  return {
    id,
    fingerprint: `fingerprint-${id}`,
    logicalKey,
    url: `http://example.test/${id}`,
    normalizedUrl: `http://example.test/${id}`,
    title: id,
    heading: id,
    textSample: id,
    accessibilitySnapshot: `- heading "${id}"`,
    persona: "customer",
    role: "customer",
    viewport: { name: "desktop", width: 1440, height: 900 },
    featureContext: {},
    depth,
    path: depth === 0 ? [] : [{ action }],
    discoveredAt: "2026-01-01T00:00:00.000Z",
    evidence: {
      screenshotPath: `${id}.png`,
      tracePath: `${id}.zip`,
      accessibilityPath: `${id}.yaml`,
      console: [],
      networkFailures: [],
      httpErrors: [],
    },
    outgoingActionCount: 1,
    blockedActions: [],
    ...overrides,
  };
}

export function transition(
  id: string,
  source: string,
  target: string,
): Transition {
  return {
    id,
    source,
    target,
    action: { ...action, id: `action-${id}` },
    discoveredAt: "2026-01-01T00:00:00.000Z",
  };
}

export function run(
  states: StateNode[],
  transitions: Transition[],
  overrides: Partial<BehaviorRun> = {},
): BehaviorRun {
  return {
    schemaVersion: 1,
    id: "run-test",
    name: "test",
    projectName: "fixture",
    projectRoot: process.cwd(),
    baseUrl: "http://example.test",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    environment: "test",
    persona: { name: "customer", role: "customer" },
    viewport: { name: "desktop", width: 1440, height: 900 },
    featureContext: {},
    options: {
      browser: "chromium",
      maxStates: 100,
      maxDepth: 8,
      allowedOrigins: ["http://example.test"],
      allowDestructive: false,
    },
    states,
    transitions,
    warnings: [],
    stats: {
      states: states.length,
      transitions: transitions.length,
      blockedActions: 0,
      durationMs: 1_000,
      truncated: false,
      errors: 0,
    },
    ...overrides,
  };
}
