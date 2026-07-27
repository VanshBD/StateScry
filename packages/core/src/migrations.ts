import type { BehaviorRun, CoverageSummary, StateNode } from "./types.js";
import { STATESCRY_SCHEMA_VERSION } from "./types.js";

function coverage(run: BehaviorRun): CoverageSummary {
  const existing = run.stats.coverage;
  if (existing) return existing;
  return {
    queuedPaths: run.states.length,
    exploredPaths: run.states.length,
    policyBlockedActions: run.stats.blockedActions ?? 0,
    repeatedActionsSkipped: 0,
    depthLimitedStates: 0,
    budgetLimited: Boolean(run.stats.truncated),
    executionFailures: run.stats.errors ?? 0,
    statement:
      "Migrated legacy run: coverage counters unavailable beyond persisted state totals.",
  };
}

function migratedState(state: StateNode): StateNode {
  return {
    ...state,
    coverageStatus:
      state.coverageStatus ??
      (state.outgoingActionCount === 0 ? "terminal" : "explored"),
    provenance: state.provenance ?? { kind: "observed" },
  };
}

export function migrateBehaviorRun(value: unknown): BehaviorRun {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Behavior run must be an object.");
  const source = structuredClone(value) as BehaviorRun;
  if (!Number.isInteger(source.schemaVersion) || source.schemaVersion < 1)
    throw new Error("Behavior run has an invalid schemaVersion.");
  if (source.schemaVersion > STATESCRY_SCHEMA_VERSION)
    throw new Error(
      `Behavior run schema ${source.schemaVersion} is newer than supported schema ${STATESCRY_SCHEMA_VERSION}.`,
    );
  if (
    !source.id ||
    !Array.isArray(source.states) ||
    !Array.isArray(source.transitions)
  )
    throw new Error("Behavior run is missing id, states, or transitions.");
  const priorSchema = source.schemaVersion;
  source.states = source.states.map(migratedState);
  source.options = {
    ...source.options,
    maxActionsPerState: source.options.maxActionsPerState ?? 60,
    explorationMode: source.options.explorationMode ?? "observe",
    mutationAllowlist: source.options.mutationAllowlist ?? [],
    evidenceMode: source.options.evidenceMode ?? "metadata",
    frameworkAdapters: source.options.frameworkAdapters ?? [],
    extensionsEnabled: source.options.extensionsEnabled ?? false,
    extensions: source.options.extensions ?? [],
  };
  source.stats = {
    ...source.stats,
    coverage: coverage(source),
    observedStates: source.stats.observedStates ?? source.states.length,
    reusedStates: source.stats.reusedStates ?? 0,
  };
  source.schemaVersion = STATESCRY_SCHEMA_VERSION;
  if (priorSchema < STATESCRY_SCHEMA_VERSION) {
    source.warnings = [
      ...(source.warnings ?? []),
      `Run metadata migrated in memory from schema ${priorSchema} to ${STATESCRY_SCHEMA_VERSION}; unavailable legacy counters were labeled rather than inferred.`,
    ];
  }
  return source;
}
