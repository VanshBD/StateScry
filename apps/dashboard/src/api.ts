import type {
  BehaviorDiff,
  BehaviorRun,
  CoverageHistory,
  RoleAccessDiff,
  ReplayResult,
  RunAnalysis,
  RunSummary,
} from "@statescry/core";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`StateScry API returned ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function getRuns(): Promise<RunSummary[]> {
  return request<RunSummary[]>("/api/runs");
}

export async function getCoverageHistory(): Promise<CoverageHistory> {
  return request<CoverageHistory>("/api/history");
}

export async function getRun(runId: string): Promise<BehaviorRun> {
  return request<BehaviorRun>(`/api/runs/${encodeURIComponent(runId)}`);
}

export async function getAnalysis(runId: string): Promise<RunAnalysis> {
  return request<RunAnalysis>(
    `/api/runs/${encodeURIComponent(runId)}/analysis`,
  );
}

export async function getDiff(
  before: string,
  after: string,
): Promise<BehaviorDiff> {
  return request<BehaviorDiff>(
    `/api/diff?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
  );
}

export async function getRoleAccess(
  less: string,
  privileged: string,
): Promise<RoleAccessDiff> {
  return request<RoleAccessDiff>(
    `/api/access?less=${encodeURIComponent(less)}&privileged=${encodeURIComponent(privileged)}`,
  );
}

export async function replayDashboardState(
  run: string,
  state: string,
): Promise<ReplayResult> {
  const response = await fetch(
    `/api/replay?run=${encodeURIComponent(run)}&state=${encodeURIComponent(state)}`,
    { method: "POST" },
  );
  if (!response.ok)
    throw new Error(`Replay failed with status ${response.status}.`);
  return response.json() as Promise<ReplayResult>;
}

export function artifactUrl(runId: string, path: string): string {
  return `/api/artifacts/${encodeURIComponent(runId)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
