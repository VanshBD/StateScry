import type { BehaviorRun } from "./types.js";

export interface CoverageHistoryPoint {
  runId: string;
  completedAt: string;
  measured: {
    states: number;
    transitions: number;
    durationMs: number;
    blockedActions: number;
    executionFailures: number;
    budgetLimited: boolean;
    observedStates: number;
    reusedStates: number;
  };
}

export interface CoverageHistory {
  points: CoverageHistoryPoint[];
  measuredTrend: {
    stateDelta: number;
    transitionDelta: number;
    durationDeltaMs: number;
  } | null;
  estimatedRecommendations: string[];
  limitations: string[];
}

export function calculateCoverageHistory(runs: BehaviorRun[]): CoverageHistory {
  const points = [...runs]
    .toSorted((a, b) => a.completedAt.localeCompare(b.completedAt))
    .map((run) => ({
      runId: run.id,
      completedAt: run.completedAt,
      measured: {
        states: run.states.length,
        transitions: run.transitions.length,
        durationMs: run.stats.durationMs,
        blockedActions: run.stats.blockedActions,
        executionFailures:
          run.stats.coverage?.executionFailures ?? run.stats.errors,
        budgetLimited: run.stats.coverage?.budgetLimited ?? run.stats.truncated,
        observedStates: run.stats.observedStates ?? run.states.length,
        reusedStates: run.stats.reusedStates ?? 0,
      },
    }));
  const first = points[0];
  const last = points.at(-1);
  const measuredTrend =
    first && last && first !== last
      ? {
          stateDelta: last.measured.states - first.measured.states,
          transitionDelta:
            last.measured.transitions - first.measured.transitions,
          durationDeltaMs: last.measured.durationMs - first.measured.durationMs,
        }
      : null;
  const latest = points.at(-1);
  const estimatedRecommendations: string[] = [];
  if (latest?.measured.budgetLimited)
    estimatedRecommendations.push(
      "Estimate: raise maxStates or narrow the declared scope, then compare measured recall before adopting the new budget.",
    );
  if ((latest?.measured.executionFailures ?? 0) > 0)
    estimatedRecommendations.push(
      "Estimate: stabilize selectors or waits; execution failures can hide reachable behavior.",
    );
  if ((latest?.measured.blockedActions ?? 0) > 0)
    estimatedRecommendations.push(
      "Review blocked actions. Keep them blocked unless a test-only mutation allowlist is justified.",
    );
  return {
    points,
    measuredTrend,
    estimatedRecommendations,
    limitations: [
      "Trend values are measured from saved runs; recommendations are labeled estimates.",
      "Different personas, viewports, feature contexts, policies, or application data should not be interpreted as a single comparable time series.",
    ],
  };
}
