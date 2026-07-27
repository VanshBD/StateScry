import { normalizeUrl } from "./fingerprint.js";
import type {
  BehaviorRun,
  ExploreOptions,
  IncrementalChangeSet,
  ReplayStep,
} from "./types.js";

export interface IncrementalPlan {
  mode: "full" | "incremental";
  forcedFull: boolean;
  invalidationReasons: string[];
  invalidatedStateIds: string[];
  reusedStateIds: string[];
  seedPaths: ReplayStep[][];
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function fileRoutes(files: string[]): string[] {
  return files.flatMap((file) => {
    const normalized = file.replaceAll("\\", "/");
    const app = normalized.match(/(?:^|\/)app\/(.+?)\/page\.[^/]+$/);
    if (app?.[1])
      return [
        `/${app[1]
          .split("/")
          .filter((part) => !part.startsWith("(") && !part.startsWith("@"))
          .join("/")}`,
      ];
    const pages = normalized.match(/(?:^|\/)pages\/(.+?)\.[^/]+$/);
    if (pages?.[1])
      return [
        `/${pages[1]}`
          .replace(/\/index$/, "")
          .replace(/\[(?:\.\.\.)?[^\]]+\]/g, "*"),
      ];
    return [];
  });
}

function pathMatches(candidate: string, declared: string): boolean {
  const normalized = declared.startsWith("http")
    ? new URL(normalizeUrl(declared)).pathname
    : declared.startsWith("/")
      ? declared
      : `/${declared}`;
  if (normalized.includes("*")) {
    const expression = new RegExp(
      `^${normalized
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]+")}(?:/|$)`,
    );
    return expression.test(candidate);
  }
  return candidate === normalized || candidate.startsWith(`${normalized}/`);
}

function incompatibleReasons(
  prior: BehaviorRun,
  options: ExploreOptions,
): string[] {
  const reasons: string[] = [];
  const priorOrigin = new URL(prior.baseUrl).origin;
  const nextOrigin = new URL(options.baseUrl).origin;
  if (priorOrigin !== nextOrigin) reasons.push("base origin changed");
  if (prior.persona.name !== options.persona.name)
    reasons.push("persona changed");
  if (prior.persona.role !== options.persona.role) reasons.push("role changed");
  if (
    prior.viewport.width !== options.viewport.width ||
    prior.viewport.height !== options.viewport.height
  )
    reasons.push("viewport dimensions changed");
  if (stableJson(prior.featureContext) !== stableJson(options.featureContext))
    reasons.push("feature context changed");
  if (prior.options.explorationMode !== options.explorationMode)
    reasons.push("exploration policy changed");
  if (
    stableJson(prior.options.mutationAllowlist ?? []) !==
    stableJson(options.mutationAllowlist)
  )
    reasons.push("mutation allowlist changed");
  return reasons;
}

function fullPlan(
  reason: string,
  prior: BehaviorRun,
  forcedFull: boolean,
): IncrementalPlan {
  return {
    mode: "full",
    forcedFull,
    invalidationReasons: [reason],
    invalidatedStateIds: prior.states.map((state) => state.id).sort(),
    reusedStateIds: [],
    seedPaths: [[]],
  };
}

function deduplicatePaths(paths: ReplayStep[][]): ReplayStep[][] {
  const byKey = new Map<string, ReplayStep[]>();
  for (const path of paths) {
    const key = path.map((step) => step.action.id).join("/") || "root";
    byKey.set(key, path);
  }
  return [...byKey.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, path]) => path);
}

export function planIncrementalExploration(
  prior: BehaviorRun,
  options: ExploreOptions,
  changes: IncrementalChangeSet,
  forceFull = false,
): IncrementalPlan {
  if (forceFull)
    return fullPlan("full mapping explicitly requested", prior, true);
  const incompatibilities = incompatibleReasons(prior, options);
  if (incompatibilities.length > 0)
    return fullPlan(
      `incremental reuse invalidated because ${incompatibilities.join(", ")}`,
      prior,
      false,
    );

  const routes = [
    ...(changes.routes ?? []),
    ...fileRoutes(changes.files ?? []),
  ];
  const selectors = new Set(changes.selectors ?? []);
  if (routes.length === 0 && selectors.size === 0)
    return fullPlan(
      "declared change set had no route, selector, or recognizable route file",
      prior,
      false,
    );

  const invalidated = new Set<string>();
  for (const state of prior.states) {
    const pathname = new URL(normalizeUrl(state.url)).pathname;
    if (routes.some((route) => pathMatches(pathname, route)))
      invalidated.add(state.id);
  }
  for (const transition of prior.transitions)
    if (selectors.has(transition.action.selector)) {
      invalidated.add(transition.source);
      invalidated.add(transition.target);
    }

  if (invalidated.size === 0)
    return fullPlan(
      "declared changes did not map to known behavior; a full run is safer",
      prior,
      false,
    );

  let expanded = true;
  const depthById = new Map(
    prior.states.map((state) => [state.id, state.depth] as const),
  );
  while (expanded) {
    expanded = false;
    for (const transition of prior.transitions)
      if (
        invalidated.has(transition.source) &&
        !invalidated.has(transition.target) &&
        (depthById.get(transition.target) ?? 0) >
          (depthById.get(transition.source) ?? 0)
      ) {
        invalidated.add(transition.target);
        expanded = true;
      }
  }

  const invalidatedStates = prior.states.filter((state) =>
    invalidated.has(state.id),
  );
  const invalidatedIncomingTargets = new Set(
    prior.transitions
      .filter(
        (transition) =>
          invalidated.has(transition.source) &&
          invalidated.has(transition.target),
      )
      .map((transition) => transition.target),
  );
  const frontier = invalidatedStates.filter(
    (state) => state.depth === 0 || !invalidatedIncomingTargets.has(state.id),
  );
  const seeds = deduplicatePaths(frontier.map((state) => state.path));
  return {
    mode: "incremental",
    forcedFull: false,
    invalidationReasons: [
      ...(routes.length > 0 ? [`route signals: ${routes.join(", ")}`] : []),
      ...(selectors.size > 0
        ? [`selector signals: ${[...selectors].sort().join(", ")}`]
        : []),
      "matched states and their observed descendants were re-explored",
    ],
    invalidatedStateIds: [...invalidated].sort(),
    reusedStateIds: prior.states
      .filter((state) => !invalidated.has(state.id))
      .map((state) => state.id)
      .sort(),
    seedPaths: seeds.length > 0 ? seeds : [[]],
  };
}
