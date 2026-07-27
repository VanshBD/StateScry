export const STATESCRY_SCHEMA_VERSION = 3;

export type BrowserName = "chromium" | "firefox" | "webkit";
export type ActionKind = "click" | "fill" | "press" | "select" | "check";
export type RiskLevel = "safe" | "review" | "blocked";
export type ExplorationMode = "observe" | "allowlist";
export type EvidenceMode = "metadata" | "screenshots" | "full";
export type StateCoverageStatus =
  | "explored"
  | "terminal"
  | "policy_limited"
  | "depth_limited"
  | "budget_limited"
  | "execution_failed";

export type FrameworkAdapterName = "dom-markers" | "next-data";

export interface FrameworkAdapterConfig {
  name: FrameworkAdapterName;
  version: 1;
  required?: boolean;
}

export interface IncrementalChangeSet {
  routes?: string[];
  selectors?: string[];
  files?: string[];
  reason?: string;
}

export interface IncrementalExploreConfig {
  priorRun: BehaviorRun;
  changes: IncrementalChangeSet;
  forceFull?: boolean;
}

export interface IncrementalRunSummary {
  mode: "full" | "incremental";
  priorRunId?: string;
  declaredChanges: IncrementalChangeSet;
  invalidationReasons: string[];
  invalidatedStateIds: string[];
  reusedStateIds: string[];
  exploredSeedPaths: number;
  forcedFull: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  name: string;
}

export interface Persona {
  name: string;
  role: string;
  storageStatePath?: string;
}

export interface MutationAllowRule {
  method: string;
  urlPattern: string;
  reason?: string;
}

export interface InputValue {
  selector: string;
  value: string;
  label?: string;
  secret?: boolean;
}

export interface CustomAction {
  name: string;
  kind: ActionKind;
  selector?: string;
  key?: string;
  value?: string;
  label?: string;
  allowInObserveMode?: boolean;
}

export interface CommandHook {
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface ReplayAssertion {
  type: "url" | "title" | "heading" | "text" | "selector";
  expected: string;
  mode?: "equals" | "contains" | "matches" | "visible";
  selector?: string;
}

export interface ExploreOptions {
  baseUrl: string;
  projectRoot: string;
  name?: string;
  browser: BrowserName;
  headless: boolean;
  maxStates: number;
  maxDepth: number;
  maxActionsPerState: number;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  settleMs: number;
  allowedOrigins: string[];
  explorationMode: ExplorationMode;
  mutationAllowlist: MutationAllowRule[];
  allowHooks: boolean;
  resetHook?: CommandHook;
  seedHook?: CommandHook;
  evidenceMode: EvidenceMode;
  redactPatterns: string[];
  ignoredTextPatterns: string[];
  inputs: InputValue[];
  customActions: CustomAction[];
  waitForSelectors: string[];
  replayAssertions: ReplayAssertion[];
  persona: Persona;
  viewport: Viewport;
  featureContext: Record<string, string>;
  commit?: string;
  environment: string;
  frameworkAdapters?: FrameworkAdapterConfig[];
  extensionModules?: string[];
  allowExtensions?: boolean;
  incremental?: IncrementalExploreConfig;
}

export interface ActionDescriptor {
  id: string;
  kind: ActionKind;
  selector: string;
  label: string;
  tag: string;
  href?: string;
  value?: string;
  key?: string;
  risk: RiskLevel;
  blockedReason?: string;
  configured?: boolean;
  secretValue?: boolean;
}

export interface ReplayStep {
  action: ActionDescriptor;
  sourceStateId?: string;
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

export interface NetworkFailure {
  url: string;
  method: string;
  error: string;
}

export interface BlockedRequest {
  url: string;
  method: string;
  reason: string;
}

export interface HttpError {
  url: string;
  method: string;
  status: number;
}

export interface StateEvidence {
  screenshotPath?: string;
  tracePath?: string;
  accessibilityPath?: string;
  console: ConsoleEntry[];
  networkFailures: NetworkFailure[];
  blockedRequests: BlockedRequest[];
  httpErrors: HttpError[];
}

export interface StateNode {
  id: string;
  fingerprint: string;
  logicalKey: string;
  url: string;
  normalizedUrl: string;
  title: string;
  heading: string;
  textSample: string;
  accessibilitySnapshot: string;
  persona: string;
  role: string;
  viewport: Viewport;
  featureContext: Record<string, string>;
  depth: number;
  path: ReplayStep[];
  discoveredAt: string;
  evidence: StateEvidence;
  outgoingActionCount: number;
  blockedActions: ActionDescriptor[];
  coverageStatus: StateCoverageStatus;
  coverageReason?: string;
  frameworkSignals?: Record<string, string>;
  provenance?: {
    kind: "observed" | "reused";
    sourceRunId?: string;
  };
}

export interface Transition {
  id: string;
  source: string;
  target: string;
  action: ActionDescriptor;
  discoveredAt: string;
}

export interface CoverageSummary {
  queuedPaths: number;
  exploredPaths: number;
  policyBlockedActions: number;
  repeatedActionsSkipped: number;
  depthLimitedStates: number;
  budgetLimited: boolean;
  executionFailures: number;
  statement: string;
}

export interface RunStats {
  states: number;
  transitions: number;
  blockedActions: number;
  durationMs: number;
  truncated: boolean;
  errors: number;
  coverage: CoverageSummary;
  observedStates?: number;
  reusedStates?: number;
}

export interface BehaviorRun {
  schemaVersion: number;
  id: string;
  name: string;
  projectName: string;
  projectRoot: string;
  baseUrl: string;
  startedAt: string;
  completedAt: string;
  commit?: string;
  environment: string;
  persona: Persona;
  viewport: Viewport;
  featureContext: Record<string, string>;
  options: {
    browser: BrowserName;
    maxStates: number;
    maxDepth: number;
    maxActionsPerState: number;
    allowedOrigins: string[];
    explorationMode: ExplorationMode;
    mutationAllowlist: MutationAllowRule[];
    evidenceMode: EvidenceMode;
    settleMs?: number;
    ignoredTextPatterns?: string[];
    frameworkAdapters?: FrameworkAdapterConfig[];
    extensionsEnabled?: boolean;
    extensions?: string[];
  };
  states: StateNode[];
  transitions: Transition[];
  warnings: string[];
  stats: RunStats;
  incremental?: IncrementalRunSummary;
}

export interface StateSummary {
  id: string;
  url: string;
  title: string;
  heading: string;
  role: string;
  viewport: string;
  depth: number;
  coverageStatus?: StateCoverageStatus;
}

export interface RunSummary {
  id: string;
  name: string;
  projectName: string;
  baseUrl: string;
  startedAt: string;
  completedAt: string;
  role: string;
  viewport: string;
  states: number;
  transitions: number;
  truncated: boolean;
}

export interface StateMatch {
  beforeStateId: string;
  afterStateId: string;
  confidence?: number;
  method: "exact_fingerprint" | "stable_route" | "content_similarity";
  explanation: string[];
}

export interface JourneyChange {
  logicalKey: string;
  beforeStateId: string;
  afterStateId: string;
  beforeDepth: number;
  afterDepth: number;
  delta: number;
  confidence?: number;
}

export interface ChangedState {
  logicalKey: string;
  before: StateSummary;
  after: StateSummary;
  reasons: string[];
  confidence?: number;
  explanation?: string[];
}

export interface BehaviorDiff {
  before: RunSummary;
  after: RunSummary;
  matches?: StateMatch[];
  added: StateSummary[];
  removed: StateSummary[];
  changed: ChangedState[];
  journeys: JourneyChange[];
  reachability?: { assessed: false; reason: string };
  newlyUnreachable?: StateSummary[];
  newlyReachable?: StateSummary[];
  riskSignals: string[];
}

export interface PermissionRisk {
  stateId: string;
  role: string;
  label: string;
  reason: string;
}

export interface RunAnalysis {
  runId: string;
  terminalStates?: StateSummary[];
  limitedStates?: StateSummary[];
  reachability?: { assessed: false; reason: string };
  cycles: string[][];
  permissionRisks: PermissionRisk[];
  blockedActions: Array<{ stateId: string; action: ActionDescriptor }>;
  deadEnds?: StateSummary[];
  unreachable?: StateSummary[];
}

export interface RoleAccessDiff {
  lessPrivilegedRun: RunSummary;
  privilegedRun: RunSummary;
  sharedStates: Array<{
    accessKey: string;
    lessPrivileged: StateSummary;
    privileged: StateSummary;
    confidence?: number;
  }>;
  suspiciousExposure: PermissionRisk[];
  privilegedOnly: StateSummary[];
  limitations?: string[];
}

export interface ReplayMismatch {
  field: "fingerprint" | "url" | "title" | "heading" | "assertion" | "action";
  expected: string;
  actual: string;
  message: string;
}

export interface ReplayDiagnostic {
  stage: "navigation" | "action" | "verification" | "network";
  code:
    | "NAVIGATION_FAILED"
    | "ACTION_BLOCKED"
    | "ACTION_FAILED"
    | "LOCATOR_FALLBACK_USED"
    | "FINAL_STATE_MISMATCH"
    | "REQUEST_BLOCKED";
  severity: "info" | "warning" | "error";
  message: string;
  stepIndex?: number;
  selector?: string;
  attemptedStrategies?: string[];
  recommendation?: string;
}

export interface ReplayResult {
  status: "verified" | "failed";
  requestedStateId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  heading: string;
  fingerprint: string;
  steps: number;
  attempts?: number;
  mismatches: ReplayMismatch[];
  diagnostics?: ReplayDiagnostic[];
  evidence?: { screenshotPath?: string; accessibilityPath?: string };
}

export interface ExplorationProgress {
  phase: "starting" | "state" | "transition" | "warning" | "complete";
  message: string;
  states: number;
  transitions: number;
}

export type ProgressListener = (progress: ExplorationProgress) => void;
