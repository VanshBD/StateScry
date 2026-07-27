import { summarizeState } from "./pathfinding.js";
import type {
  BehaviorDiff,
  BehaviorRun,
  ChangedState,
  JourneyChange,
  RunSummary,
  StateMatch,
  StateNode,
} from "./types.js";

export function summarizeRun(run: BehaviorRun): RunSummary {
  return {
    id: run.id,
    name: run.name,
    projectName: run.projectName,
    baseUrl: run.baseUrl,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    role: run.persona.role,
    viewport: run.viewport.name,
    states: run.states.length,
    transitions: run.transitions.length,
    truncated: run.stats.truncated,
  };
}
function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}
function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((item) => right.has(item)).length / union.size;
}
function sameContext(left: StateNode, right: StateNode): boolean {
  return (
    left.role === right.role &&
    left.viewport.name === right.viewport.name &&
    JSON.stringify(left.featureContext) === JSON.stringify(right.featureContext)
  );
}
function score(
  left: StateNode,
  right: StateNode,
): { confidence: number; method: StateMatch["method"]; explanation: string[] } {
  if (left.fingerprint === right.fingerprint)
    return {
      confidence: 1,
      method: "exact_fingerprint",
      explanation: ["Exact normalized fingerprint matched."],
    };
  const explanations: string[] = [];
  let confidence = 0;
  if (left.logicalKey === right.logicalKey) {
    confidence += 0.75;
    explanations.push("Stable logical key matched.");
  }
  if (left.normalizedUrl === right.normalizedUrl) {
    confidence += 0.45;
    explanations.push("Normalized URL matched.");
  }
  if (left.heading && left.heading === right.heading) {
    confidence += 0.2;
    explanations.push("Primary heading matched.");
  }
  if (left.title && left.title === right.title) {
    confidence += 0.1;
    explanations.push("Title matched.");
  }
  const content = jaccard(
    tokens(left.accessibilitySnapshot),
    tokens(right.accessibilitySnapshot),
  );
  confidence += content * 0.25;
  if (content >= 0.7)
    explanations.push("Accessibility content was highly similar.");
  return {
    confidence,
    method:
      left.normalizedUrl === right.normalizedUrl
        ? "stable_route"
        : "content_similarity",
    explanation: explanations.length
      ? explanations
      : ["Content similarity was used; inspect this lower-confidence match."],
  };
}
function reasons(before: StateNode, after: StateNode): string[] {
  const result: string[] = [];
  if (before.fingerprint !== after.fingerprint)
    result.push("normalized visible state changed");
  if (before.normalizedUrl !== after.normalizedUrl)
    result.push("normalized URL changed");
  if (before.heading !== after.heading) result.push("primary heading changed");
  if (before.outgoingActionCount !== after.outgoingActionCount)
    result.push(
      "available actions changed from " +
        before.outgoingActionCount +
        " to " +
        after.outgoingActionCount,
    );
  return result;
}

export function compareRuns(
  before: BehaviorRun,
  after: BehaviorRun,
): BehaviorDiff {
  const remaining = new Set(after.states.map((state) => state.id));
  const matches: StateMatch[] = [];
  for (const source of before.states) {
    let candidate: StateNode | undefined;
    let best: ReturnType<typeof score> | undefined;
    for (const target of after.states) {
      if (!remaining.has(target.id) || !sameContext(source, target)) continue;
      const current = score(source, target);
      if (!best || current.confidence > best.confidence) {
        best = current;
        candidate = target;
      }
    }
    if (candidate && best && best.confidence >= 0.72) {
      remaining.delete(candidate.id);
      matches.push({
        beforeStateId: source.id,
        afterStateId: candidate.id,
        confidence: Number(best.confidence.toFixed(2)),
        method: best.method,
        explanation: best.explanation,
      });
    }
  }
  const matchedBefore = new Set(matches.map((match) => match.beforeStateId));
  const byBefore = new Map(before.states.map((state) => [state.id, state]));
  const byAfter = new Map(after.states.map((state) => [state.id, state]));
  const changed: ChangedState[] = [];
  const journeys: JourneyChange[] = [];
  for (const match of matches) {
    const left = byBefore.get(match.beforeStateId)!;
    const right = byAfter.get(match.afterStateId)!;
    const changes = reasons(left, right);
    const confidence = match.confidence ?? 0;
    if (changes.length)
      changed.push({
        logicalKey: left.logicalKey,
        before: summarizeState(left),
        after: summarizeState(right),
        reasons: changes,
        confidence,
        explanation: match.explanation,
      });
    if (left.depth !== right.depth)
      journeys.push({
        logicalKey: left.logicalKey,
        beforeStateId: left.id,
        afterStateId: right.id,
        beforeDepth: left.depth,
        afterDepth: right.depth,
        delta: right.depth - left.depth,
        confidence,
      });
  }
  const added = after.states
    .filter((state) => remaining.has(state.id))
    .map(summarizeState);
  const removed = before.states
    .filter((state) => !matchedBefore.has(state.id))
    .map(summarizeState);
  const riskSignals: string[] = [];
  if (removed.length)
    riskSignals.push(
      removed.length +
        " previously discovered state(s) did not match the candidate run",
    );
  if (changed.some((state) => (state.confidence ?? 0) < 0.85))
    riskSignals.push(
      "Some changed-state matches are confidence-limited; inspect their explanations.",
    );
  return {
    before: summarizeRun(before),
    after: summarizeRun(after),
    matches,
    added,
    removed,
    changed,
    journeys,
    reachability: {
      assessed: false,
      reason:
        "Black-box state discovery has no declared inventory, so StateScry does not claim states are unreachable.",
    },
    riskSignals,
  };
}
