import type {
  BehaviorDiff,
  BehaviorRun,
  ReplayResult,
  RunStats,
} from "@statescry-tool/core";

export interface BehaviorReportMetadata {
  confidence: {
    matchedStates: number;
    average: number | null;
    minimum: number | null;
  };
  coverage: {
    baseline: string;
    candidate: string;
    candidateBudgetLimited: boolean;
    candidatePolicyBlockedActions: number;
    candidateExecutionFailures: number;
  };
  replay: {
    supplied: boolean;
    attempts: number;
    verified: number;
    failed: number;
  };
}

export type BehaviorReport = BehaviorDiff & {
  reportMetadata: BehaviorReportMetadata;
};

function coverage(run: BehaviorRun): RunStats["coverage"] | undefined {
  return (run.stats as RunStats).coverage;
}

export function createBehaviorReport(
  diff: BehaviorDiff,
  before: BehaviorRun,
  after: BehaviorRun,
  replayResults: ReplayResult[] = [],
): BehaviorReport {
  const confidences = (diff.matches ?? []).map(
    (match) => match.confidence ?? 0,
  );
  const beforeCoverage = coverage(before);
  const afterCoverage = coverage(after);
  return {
    ...diff,
    reportMetadata: {
      confidence: {
        matchedStates: confidences.length,
        average: confidences.length
          ? Number(
              (
                confidences.reduce((total, value) => total + value, 0) /
                confidences.length
              ).toFixed(4),
            )
          : null,
        minimum: confidences.length
          ? Number(Math.min(...confidences).toFixed(4))
          : null,
      },
      coverage: {
        baseline:
          beforeCoverage?.statement ??
          "This legacy run has no structured coverage statement.",
        candidate:
          afterCoverage?.statement ??
          "This legacy run has no structured coverage statement.",
        candidateBudgetLimited: afterCoverage?.budgetLimited ?? false,
        candidatePolicyBlockedActions: afterCoverage?.policyBlockedActions ?? 0,
        candidateExecutionFailures: afterCoverage?.executionFailures ?? 0,
      },
      replay: {
        supplied: replayResults.length > 0,
        attempts: replayResults.length,
        verified: replayResults.filter((result) => result.status === "verified")
          .length,
        failed: replayResults.filter((result) => result.status === "failed")
          .length,
      },
    },
  };
}

function displayConfidence(value: number | null): string {
  return value === null ? "not available" : `${(value * 100).toFixed(1)}%`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function behaviorReportMarkdown(report: BehaviorReport): string {
  const changed =
    report.added.length + report.removed.length + report.changed.length;
  const lines = [
    "# StateScry behavior report",
    "",
    `**Decision:** ${changed === 0 ? "No discovered behavior changes" : `${changed} discovered behavior changes require review`}`,
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Added states | ${report.added.length} |`,
    `| Removed states | ${report.removed.length} |`,
    `| Changed states | ${report.changed.length} |`,
    `| Journey changes | ${report.journeys.length} |`,
    `| Replay verified | ${report.reportMetadata.replay.verified}/${report.reportMetadata.replay.attempts || "not supplied"} |`,
    "",
    "## Match confidence",
    "",
    `- Matched states: ${report.reportMetadata.confidence.matchedStates}`,
    `- Average confidence: ${displayConfidence(report.reportMetadata.confidence.average)}`,
    `- Minimum confidence: ${displayConfidence(report.reportMetadata.confidence.minimum)}`,
    "",
    "## Coverage limits",
    "",
    `- Baseline: ${report.reportMetadata.coverage.baseline}`,
    `- Candidate: ${report.reportMetadata.coverage.candidate}`,
    `- Candidate budget limited: ${report.reportMetadata.coverage.candidateBudgetLimited}`,
    `- Candidate policy-blocked actions: ${report.reportMetadata.coverage.candidatePolicyBlockedActions}`,
    `- Candidate execution failures: ${report.reportMetadata.coverage.candidateExecutionFailures}`,
    "",
    "## Added states",
    "",
    ...(report.added.length
      ? report.added.map(
          (state) =>
            `- **${escapeTable(state.heading || state.title || state.id)}** — ${escapeTable(state.url)}`,
        )
      : ["- None"]),
    "",
    "## Removed states",
    "",
    ...(report.removed.length
      ? report.removed.map(
          (state) =>
            `- **${escapeTable(state.heading || state.title || state.id)}** — ${escapeTable(state.url)}`,
        )
      : ["- None"]),
    "",
    "## Changed states",
    "",
    ...(report.changed.length
      ? report.changed.map((state) =>
          `- **${escapeTable(state.after.heading || state.after.title || state.logicalKey)}** (${displayConfidence(state.confidence ?? null)}): ${state.reasons.map(escapeTable).join(", ")}. ${state.explanation?.map(escapeTable).join(" ") ?? ""}`.trim(),
        )
      : ["- None"]),
    "",
    "## Risk signals",
    "",
    ...(report.riskSignals.length
      ? report.riskSignals.map((item) => `- ${item}`)
      : ["- None"]),
    "",
    "## Reachability",
    "",
    report.reachability?.reason ?? "Not assessed",
    "",
    "> StateScry reports observed, bounded behavior. This report is not proof of complete application or security coverage.",
    "",
  ];
  return lines.join("\n");
}

function workflowEscape(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

export function behaviorReportAnnotations(report: BehaviorReport): string[] {
  return [
    ...report.removed.map(
      (state) =>
        `::warning title=StateScry removed state::${workflowEscape(`${state.heading || state.title || state.id} at ${state.url}`)}`,
    ),
    ...report.changed.map(
      (state) =>
        `::warning title=StateScry behavior change::${workflowEscape(`${state.after.heading || state.after.title || state.logicalKey}: ${state.reasons.join(", ")}`)}`,
    ),
    ...report.riskSignals.map(
      (risk) =>
        `::warning title=StateScry risk signal::${workflowEscape(risk)}`,
    ),
  ];
}
