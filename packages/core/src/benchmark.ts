import { compareRuns } from "./diff.js";
import type { BehaviorRun, ReplayResult } from "./types.js";

export interface BenchmarkStateExpectation {
  logicalKey: string;
  replayRequired?: boolean;
}

export interface BenchmarkTransitionExpectation {
  source: string;
  target: string;
}

export interface BenchmarkDiffExpectation {
  added?: string[];
  removed?: string[];
  changed?: string[];
}

export interface BenchmarkThresholds {
  stateRecall?: number;
  statePrecision?: number;
  duplicateRateMaximum?: number;
  transitionRecall?: number;
  diffPrecision?: number;
  diffRecall?: number;
  replayReliability?: number;
  safety?: number;
  privacy?: number;
  overall?: number;
}

export interface BenchmarkManifest {
  schemaVersion: 1;
  name: string;
  description?: string;
  states: BenchmarkStateExpectation[];
  transitions?: BenchmarkTransitionExpectation[];
  diff?: BenchmarkDiffExpectation;
  safety?: { maximumCompletedUnapprovedMutations: number };
  privacy?: { maximumDetectedSecretLeaks: number };
  thresholds?: BenchmarkThresholds;
}

export interface BenchmarkInput {
  run: BehaviorRun;
  beforeRun?: BehaviorRun;
  replayResults?: ReplayResult[];
  completedUnapprovedMutations?: number;
  detectedSecretLeaks?: number;
}

export interface BenchmarkMetric {
  score: number;
  numerator: number;
  denominator: number;
  threshold: number;
  passed: boolean;
  explanation: string;
}

export interface BenchmarkResult {
  manifest: string;
  runId: string;
  score: number;
  passed: boolean;
  metrics: Partial<
    Record<
      | "stateRecall"
      | "statePrecision"
      | "duplicateRate"
      | "transitionRecall"
      | "diffPrecision"
      | "diffRecall"
      | "replayReliability"
      | "safety"
      | "privacy",
      BenchmarkMetric
    >
  >;
  failures: string[];
  limitations: string[];
}

const DEFAULT_THRESHOLDS: Required<BenchmarkThresholds> = {
  stateRecall: 0.9,
  statePrecision: 0.97,
  duplicateRateMaximum: 0.03,
  transitionRecall: 0.9,
  diffPrecision: 0.95,
  diffRecall: 0.9,
  replayReliability: 0.95,
  safety: 1,
  privacy: 1,
  overall: 0.9,
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function metric(
  numerator: number,
  denominator: number,
  threshold: number,
  explanation: string,
  mode: "minimum" | "maximum" = "minimum",
): BenchmarkMetric {
  const score = rounded(ratio(numerator, denominator));
  return {
    score,
    numerator,
    denominator,
    threshold,
    passed: mode === "minimum" ? score >= threshold : score <= threshold,
    explanation,
  };
}

function transitionKey(source: string, target: string): string {
  return `${source} -> ${target}`;
}

function changeSet(values: string[] | undefined): Set<string> {
  return new Set(values ?? []);
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let matches = 0;
  for (const value of left) if (right.has(value)) matches += 1;
  return matches;
}

function validateManifest(manifest: BenchmarkManifest): void {
  if (manifest.schemaVersion !== 1)
    throw new Error("Benchmark manifest schemaVersion must be 1.");
  if (!manifest.name.trim())
    throw new Error("Benchmark manifest needs a name.");
  if (!Array.isArray(manifest.states) || manifest.states.length === 0)
    throw new Error("Benchmark manifest needs at least one expected state.");
  const logicalKeys = manifest.states.map((state) => state.logicalKey);
  if (logicalKeys.some((key) => !key.trim()))
    throw new Error("Benchmark state logicalKey values cannot be empty.");
  if (new Set(logicalKeys).size !== logicalKeys.length)
    throw new Error("Benchmark state logicalKey values must be unique.");
  for (const [name, value] of [
    [
      "safety.maximumCompletedUnapprovedMutations",
      manifest.safety?.maximumCompletedUnapprovedMutations,
    ],
    [
      "privacy.maximumDetectedSecretLeaks",
      manifest.privacy?.maximumDetectedSecretLeaks,
    ],
  ] as const)
    if (value !== undefined && (!Number.isInteger(value) || value < 0))
      throw new Error(`${name} must be a non-negative integer.`);
}

export function evaluateBenchmark(
  manifest: BenchmarkManifest,
  input: BenchmarkInput,
): BenchmarkResult {
  validateManifest(manifest);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...manifest.thresholds };
  const metrics: BenchmarkResult["metrics"] = {};
  const expectedStates = new Set(
    manifest.states.map((state) => state.logicalKey),
  );
  const actualStateKeys = input.run.states.map((state) => state.logicalKey);
  const actualStates = new Set(actualStateKeys);
  const matchedStates = intersectionSize(expectedStates, actualStates);
  metrics.stateRecall = metric(
    matchedStates,
    expectedStates.size,
    thresholds.stateRecall,
    "Expected meaningful states discovered by the run.",
  );
  metrics.statePrecision = metric(
    matchedStates,
    actualStates.size,
    thresholds.statePrecision,
    "Discovered unique states present in the declared benchmark inventory.",
  );
  const duplicateCount = actualStateKeys.length - actualStates.size;
  metrics.duplicateRate = metric(
    duplicateCount,
    actualStateKeys.length,
    thresholds.duplicateRateMaximum,
    "Repeated logical states divided by all discovered states.",
    "maximum",
  );

  if (manifest.transitions) {
    const byId = new Map(
      input.run.states.map((state) => [state.id, state.logicalKey]),
    );
    const actualTransitions = new Set(
      input.run.transitions.map((transition) =>
        transitionKey(
          byId.get(transition.source) ?? transition.source,
          byId.get(transition.target) ?? transition.target,
        ),
      ),
    );
    const expectedTransitions = new Set(
      manifest.transitions.map((transition) =>
        transitionKey(transition.source, transition.target),
      ),
    );
    metrics.transitionRecall = metric(
      intersectionSize(expectedTransitions, actualTransitions),
      expectedTransitions.size,
      thresholds.transitionRecall,
      "Expected state transitions discovered by the run.",
    );
  }

  if (manifest.diff && input.beforeRun) {
    const diff = compareRuns(input.beforeRun, input.run);
    const expectedAdded = changeSet(manifest.diff.added);
    const expectedRemoved = changeSet(manifest.diff.removed);
    const expectedChanged = changeSet(manifest.diff.changed);
    const afterLogicalKey = new Map(
      input.run.states.map((state) => [state.id, state.logicalKey]),
    );
    const beforeLogicalKey = new Map(
      input.beforeRun.states.map((state) => [state.id, state.logicalKey]),
    );
    const actualAdded = new Set(
      diff.added.map((state) => afterLogicalKey.get(state.id) ?? state.id),
    );
    const actualRemoved = new Set(
      diff.removed.map((state) => beforeLogicalKey.get(state.id) ?? state.id),
    );
    const actualChanged = new Set(
      diff.changed.map((state) => state.logicalKey),
    );
    const expectedChanges = new Set([
      ...[...expectedAdded].map((key) => `added:${key}`),
      ...[...expectedRemoved].map((key) => `removed:${key}`),
      ...[...expectedChanged].map((key) => `changed:${key}`),
    ]);
    const actualChanges = new Set([
      ...[...actualAdded].map((key) => `added:${key}`),
      ...[...actualRemoved].map((key) => `removed:${key}`),
      ...[...actualChanged].map((key) => `changed:${key}`),
    ]);
    const correctChanges = intersectionSize(expectedChanges, actualChanges);
    metrics.diffPrecision = metric(
      correctChanges,
      actualChanges.size,
      thresholds.diffPrecision,
      "Reported changes that match planted benchmark changes.",
    );
    metrics.diffRecall = metric(
      correctChanges,
      expectedChanges.size,
      thresholds.diffRecall,
      "Planted benchmark changes reported by StateScry.",
    );
  } else if (manifest.diff) {
    metrics.diffPrecision = metric(
      0,
      1,
      thresholds.diffPrecision,
      "A planted diff was declared, but no baseline run was supplied.",
    );
    metrics.diffRecall = metric(
      0,
      1,
      thresholds.diffRecall,
      "A planted diff was declared, but no baseline run was supplied.",
    );
  }

  const replayRequired = new Set(
    manifest.states
      .filter((state) => state.replayRequired)
      .map((state) => state.logicalKey),
  );
  if (replayRequired.size > 0) {
    const replayedLogicalKeys = new Set(
      (input.replayResults ?? [])
        .filter((result) => result.status === "verified")
        .map(
          (result) =>
            input.run.states.find(
              (state) => state.id === result.requestedStateId,
            )?.logicalKey,
        )
        .filter((value): value is string => Boolean(value)),
    );
    metrics.replayReliability = metric(
      intersectionSize(replayRequired, replayedLogicalKeys),
      replayRequired.size,
      thresholds.replayReliability,
      "Required benchmark states with verified replay results.",
    );
  }

  if (
    manifest.safety !== undefined ||
    input.completedUnapprovedMutations !== undefined
  ) {
    const actual = input.completedUnapprovedMutations;
    const maximum = manifest.safety?.maximumCompletedUnapprovedMutations ?? 0;
    metrics.safety = metric(
      actual !== undefined && actual <= maximum ? 1 : 0,
      1,
      thresholds.safety,
      actual === undefined
        ? "A safety outcome was required by the manifest but not supplied."
        : `${actual} unapproved mutation(s) completed; maximum allowed is ${maximum}.`,
    );
  }
  if (
    manifest.privacy !== undefined ||
    input.detectedSecretLeaks !== undefined
  ) {
    const actual = input.detectedSecretLeaks;
    const maximum = manifest.privacy?.maximumDetectedSecretLeaks ?? 0;
    metrics.privacy = metric(
      actual !== undefined && actual <= maximum ? 1 : 0,
      1,
      thresholds.privacy,
      actual === undefined
        ? "A privacy outcome was required by the manifest but not supplied."
        : `${actual} planted secret leak(s) detected; maximum allowed is ${maximum}.`,
    );
  }

  const available = Object.entries(metrics) as Array<[string, BenchmarkMetric]>;
  const normalizedScores = available.map(([name, value]) =>
    name === "duplicateRate" ? 1 - value.score : value.score,
  );
  const score = rounded(
    ratio(
      normalizedScores.reduce((total, value) => total + value, 0),
      normalizedScores.length,
    ),
  );
  const failures = available
    .filter(([, value]) => !value.passed)
    .map(
      ([name, value]) =>
        `${name} scored ${value.score}; required ${value.threshold}.`,
    );
  if (score < thresholds.overall)
    failures.push(`overall scored ${score}; required ${thresholds.overall}.`);
  return {
    manifest: manifest.name,
    runId: input.run.id,
    score,
    passed: failures.length === 0,
    metrics,
    failures,
    limitations: [
      "Scores are meaningful only when the manifest inventory was independently reviewed and represents the intended reachable behavior.",
      "A benchmark score does not prove complete behavior or security coverage outside its declared fixtures.",
    ],
  };
}
