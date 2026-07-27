import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Camera,
  ChevronDown,
  Crosshair,
  GitCompareArrows,
  LoaderCircle,
  Maximize2,
  Minus,
  Network,
  Plus,
  Route,
  Search,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";

import type {
  BehaviorDiff,
  BehaviorRun,
  CoverageHistory,
  RoleAccessDiff,
  ReplayResult,
  RunAnalysis,
  RunSummary,
  StateNode,
} from "@statescry-tool/core";

import {
  artifactUrl,
  getAnalysis,
  getCoverageHistory,
  getDiff,
  getRoleAccess,
  getRun,
  getRuns,
  replayDashboardState,
} from "./api.js";
import { GraphCanvas, type GraphHandle } from "./GraphCanvas.js";

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function EmptyDashboard() {
  return (
    <main className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <img src="/brand/statescry-mark.png" alt="" />
      </div>
      <p className="eyebrow">No behavior runs yet</p>
      <h1>Map the application reality.</h1>
      <p>
        Start your app, then ask StateScry to discover its states, transitions,
        replay paths, and evidence.
      </p>
      <pre>
        <code>statescry map http://localhost:3000 --name baseline</code>
      </pre>
    </main>
  );
}

interface InspectorProps {
  run: BehaviorRun;
  state: StateNode;
  comparisonRun?: BehaviorRun | undefined;
  comparisonState?: StateNode | undefined;
  onClose: () => void;
}

function Inspector({
  run,
  state,
  comparisonRun,
  comparisonState,
  onClose,
}: InspectorProps) {
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [capturedScreenshot, setCapturedScreenshot] = useState<string | undefined>();

  useEffect(() => {
    setReplay(null);
    setReplayError("");
    setCapturedScreenshot(undefined);
  }, [state.id]);

  const handleReplay = async () => {
    setReplaying(true);
    setReplayError("");
    try {
      const result = await replayDashboardState(run.id, state.id);
      setReplay(result);
      if (result.evidence?.screenshotPath) {
        state.evidence.screenshotPath = result.evidence.screenshotPath;
        setCapturedScreenshot(result.evidence.screenshotPath);
      }
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplaying(false);
    }
  };

  const activeScreenshot = capturedScreenshot || state.evidence.screenshotPath;

  return (
    <aside className="inspector" aria-label="State evidence">
      <header className="inspector-header">
        <div>
          <p className="eyebrow">State evidence</p>
          <h2>{state.heading || state.title || "Unnamed state"}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close inspector"
        >
          <X size={18} />
        </button>
      </header>
      <div
        className={`screenshot-frame ${comparisonState ? "visual-diff" : ""}`}
      >
        {comparisonRun && comparisonState ? (
          <>
            <figure>
              <figcaption>Baseline</figcaption>
              {comparisonState.evidence.screenshotPath ? (
                <img
                  src={artifactUrl(
                    comparisonRun.id,
                    comparisonState.evidence.screenshotPath,
                  )}
                  alt={`Baseline screenshot of ${comparisonState.heading || comparisonState.title || comparisonState.url}`}
                />
              ) : (
                <p className="empty-copy">No baseline screenshot.</p>
              )}
            </figure>
            <figure>
              <figcaption>Current</figcaption>
              {activeScreenshot ? (
                <img
                  src={artifactUrl(run.id, activeScreenshot)}
                  alt={`Current screenshot of ${state.heading || state.title || state.url}`}
                />
              ) : (
                <p className="empty-copy">No current screenshot.</p>
              )}
            </figure>
          </>
        ) : activeScreenshot ? (
          <img
            src={artifactUrl(run.id, activeScreenshot)}
            alt={`Screenshot of ${state.heading || state.title || state.url}`}
          />
        ) : (
          <div className="empty-evidence-card">
            <Camera size={28} className="empty-icon" />
            <p className="empty-copy">
              No static screenshot saved for this state.
            </p>
            <span className="empty-hint">
              Mapped in <code>privacy-first</code> metadata mode.
            </span>
            <button
              type="button"
              className="capture-btn"
              onClick={handleReplay}
              disabled={replaying}
            >
              {replaying ? "Replaying & Capturing…" : "📷 Capture Screenshot Now"}
            </button>
          </div>
        )}
      </div>
      <nav className="evidence-links" aria-label="Evidence files">
        {state.evidence.screenshotPath ? (
          <a
            href={artifactUrl(run.id, state.evidence.screenshotPath)}
            target="_blank"
            rel="noreferrer"
          >
            Screenshot
          </a>
        ) : null}
        {state.evidence.accessibilityPath ? (
          <a
            href={artifactUrl(run.id, state.evidence.accessibilityPath)}
            target="_blank"
            rel="noreferrer"
          >
            Accessibility snapshot
          </a>
        ) : null}
        {state.evidence.tracePath ? (
          <a href={artifactUrl(run.id, state.evidence.tracePath)} download>
            Trace
          </a>
        ) : null}
      </nav>
      <dl className="facts">
        <div>
          <dt>State ID</dt>
          <dd>{state.id}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{state.role}</dd>
        </div>
        <div>
          <dt>Viewport</dt>
          <dd>
            {state.viewport.name} · {state.viewport.width}×
            {state.viewport.height}
          </dd>
        </div>
        <div>
          <dt>URL</dt>
          <dd className="wrap">{state.url}</dd>
        </div>
      </dl>
      <section className="journey">
        <div className="section-title">
          <Route size={16} />
          <h3>Shortest known path</h3>
          <span>{state.path.length} steps</span>
        </div>
        {state.path.length === 0 ? (
          <p className="muted-copy">This is the root state.</p>
        ) : (
          <ol>
            {state.path.map((step, index) => (
              <li key={`${step.action.id}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.action.label}</strong>
                  <code>{step.action.selector}</code>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="replay-card" aria-live="polite">
        <div className="section-title">
          <Route size={16} />
          <h3>Verified replay</h3>
        </div>
        <button type="button" onClick={handleReplay} disabled={replaying}>
          {replaying ? "Replaying…" : "Replay this state"}
        </button>
        {replay ? (
          <div className={`replay-result ${replay.status}`}>
            <strong>
              {replay.status === "verified" ? "Verified" : "Failed"}
            </strong>
            <span>
              {replay.steps} steps · {replay.mismatches.length} mismatches
            </span>
            {replay.mismatches.map((mismatch, index) => (
              <p key={`${mismatch.field}-${index}`}>{mismatch.message}</p>
            ))}
            {replay.diagnostics?.map((diagnostic, index) => (
              <p key={`${diagnostic.code}-${index}`}>
                {diagnostic.message}
                {diagnostic.recommendation
                  ? ` Recommendation: ${diagnostic.recommendation}`
                  : ""}
              </p>
            ))}
          </div>
        ) : null}
        {replayError ? <p className="replay-error">{replayError}</p> : null}
      </section>
      <section className="evidence-grid">
        <div>
          <TerminalSquare size={16} />
          <span>Console</span>
          <strong>{state.evidence.console.length}</strong>
        </div>
        <div>
          <AlertTriangle size={16} />
          <span>HTTP errors</span>
          <strong>{state.evidence.httpErrors.length}</strong>
        </div>
      </section>
    </aside>
  );
}

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<BehaviorRun | null>(null);
  const [analysis, setAnalysis] = useState<RunAnalysis | null>(null);
  const [comparisonId, setComparisonId] = useState("");
  const [diff, setDiff] = useState<BehaviorDiff | null>(null);
  const [roleAccess, setRoleAccess] = useState<RoleAccessDiff | null>(null);
  const [comparisonRun, setComparisonRun] = useState<BehaviorRun | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<CoverageHistory | null>(null);
  const graphRef = useRef<GraphHandle>(null);

  useEffect(() => {
    Promise.all([getRuns(), getCoverageHistory()])
      .then(([availableRuns, coverageHistory]) => {
        setRuns(availableRuns);
        setHistory(coverageHistory);
        setSelectedRunId(availableRuns[0]?.id ?? "");
      })
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setRun(null);
      setAnalysis(null);
      return;
    }
    setLoading(true);
    setSelectedStateId(undefined);
    Promise.all([getRun(selectedRunId), getAnalysis(selectedRunId)])
      .then(([nextRun, nextAnalysis]) => {
        setRun(nextRun);
        setAnalysis(nextAnalysis);
        setError("");
      })
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        ),
      )
      .finally(() => setLoading(false));
  }, [selectedRunId]);

  useEffect(() => {
    if (!comparisonId || !selectedRunId || comparisonId === selectedRunId) {
      setDiff(null);
      setRoleAccess(null);
      setComparisonRun(null);
      return;
    }
    Promise.all([
      getDiff(comparisonId, selectedRunId),
      getRoleAccess(comparisonId, selectedRunId),
      getRun(comparisonId),
    ])
      .then(([nextDiff, nextAccess, nextComparisonRun]) => {
        setDiff(nextDiff);
        setRoleAccess(nextAccess);
        setComparisonRun(nextComparisonRun);
      })
      .catch(() => {
        setDiff(null);
        setRoleAccess(null);
        setComparisonRun(null);
      });
  }, [comparisonId, selectedRunId]);

  const selectedState = useMemo(
    () => run?.states.find((state) => state.id === selectedStateId),
    [run, selectedStateId],
  );
  const comparisonState = useMemo(() => {
    if (!selectedStateId || !diff || !comparisonRun) return undefined;
    const match = diff.matches?.find(
      (candidate) => candidate.afterStateId === selectedStateId,
    );
    return comparisonRun.states.find(
      (candidate) => candidate.id === match?.beforeStateId,
    );
  }, [comparisonRun, diff, selectedStateId]);
  const handleSelectState = useCallback((stateId: string) => {
    setSelectedStateId(stateId);
  }, []);

  if (loading && !run && runs.length === 0) {
    return (
      <main className="loading-state">
        <LoaderCircle className="spin" size={28} />
        <span>Loading the behavior graph…</span>
      </main>
    );
  }
  if (!loading && runs.length === 0) return <EmptyDashboard />;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="StateScry dashboard">
          <span className="brand-mark">
            <img src="/brand/statescry-mark.png" alt="" />
          </span>
          <span>StateScry</span>
          <small>local</small>
        </a>
        <div className="run-picker">
          <label htmlFor="run-select">Behavior run</label>
          <div className="select-wrap">
            <select
              id="run-select"
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
            >
              {runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.role}/{item.viewport}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </div>
        <div className="topbar-meta">
          <span className="status-dot" />
          Local engine
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {run && analysis ? (
        <>
          <section className="summary-strip" aria-label="Run summary">
            <div className="run-identity">
              <p className="eyebrow">{run.environment} behavior snapshot</p>
              <h1>{run.name}</h1>
              <span>{run.baseUrl}</span>
            </div>
            <div className="metric">
              <Box size={17} />
              <span>States</span>
              <strong>{run.states.length}</strong>
            </div>
            <div className="metric">
              <GitCompareArrows size={17} />
              <span>Transitions</span>
              <strong>{run.transitions.length}</strong>
            </div>
            <div className="metric warning">
              <AlertTriangle size={17} />
              <span>Dead ends</span>
              <strong>
                {(analysis.terminalStates ?? analysis.deadEnds ?? []).length}
              </strong>
            </div>
            <div className="metric danger">
              <ShieldAlert size={17} />
              <span>Access risks</span>
              <strong>{analysis.permissionRisks.length}</strong>
            </div>
            <div className="metric">
              <Crosshair size={17} />
              <span>Mapped in</span>
              <strong>{formatDuration(run.stats.durationMs)}</strong>
            </div>
            <div className="metric">
              <Network size={17} />
              <span>
                {run.incremental?.mode === "incremental"
                  ? "Observed / reused"
                  : "Observed"}
              </span>
              <strong>
                {run.stats.observedStates ?? run.states.length}
                {run.incremental?.mode === "incremental"
                  ? ` / ${run.stats.reusedStates ?? 0}`
                  : ""}
              </strong>
            </div>
          </section>

          <section
            className="comparison-strip"
            aria-label="Behavior comparison"
          >
            <label htmlFor="comparison-select">Compare this run against</label>
            <select
              id="comparison-select"
              value={comparisonId}
              onChange={(event) => setComparisonId(event.target.value)}
            >
              <option value="">No comparison selected</option>
              {runs
                .filter((item) => item.id !== selectedRunId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.role}/{item.viewport}
                  </option>
                ))}
            </select>
            {diff ? (
              <p>
                <strong>{diff.added.length}</strong> added ·{" "}
                <strong>{diff.removed.length}</strong> removed ·{" "}
                <strong>{diff.changed.length}</strong> changed ·{" "}
                {diff.reachability?.reason ?? "Reachability not assessed"}
              </p>
            ) : (
              <p>
                Select a baseline to view behavior and role-context changes.
              </p>
            )}
            {roleAccess ? (
              <p>
                <strong>{roleAccess.suspiciousExposure.length}</strong> possible
                exposures · <strong>{roleAccess.privilegedOnly.length}</strong>{" "}
                privileged-only states
              </p>
            ) : null}
          </section>

          {run.stats.coverage.budgetLimited ||
          run.stats.coverage.depthLimitedStates > 0 ||
          run.stats.coverage.policyBlockedActions > 0 ||
          run.stats.coverage.executionFailures > 0 ? (
            <section
              className="coverage-strip"
              aria-label="Coverage limitations"
              role="status"
            >
              <strong>Partial coverage</strong>
              <span>{run.stats.coverage.statement}</span>
              <span>
                {run.stats.coverage.depthLimitedStates} depth-limited states
              </span>
              <span>
                {run.stats.coverage.policyBlockedActions} policy-blocked actions
              </span>
              <span>
                {run.stats.coverage.executionFailures} execution failures
              </span>
            </section>
          ) : null}

          {run.incremental || run.options.frameworkAdapters?.length ? (
            <section className="provenance-strip" aria-label="Run provenance">
              <strong>
                {run.incremental?.mode === "incremental"
                  ? "Incremental map"
                  : "Full map"}
              </strong>
              {run.incremental ? (
                <span>
                  {run.incremental.invalidatedStateIds.length} invalidated;{" "}
                  {run.incremental.reusedStateIds.length} safely reused
                </span>
              ) : null}
              {run.options.frameworkAdapters?.length ? (
                <span>
                  adapters:{" "}
                  {run.options.frameworkAdapters
                    .map((adapter) => `${adapter.name}@${adapter.version}`)
                    .join(", ")}
                </span>
              ) : null}
              {history?.measuredTrend ? (
                <span>
                  measured trend:{" "}
                  {history.measuredTrend.stateDelta >= 0 ? "+" : ""}
                  {history.measuredTrend.stateDelta} states
                </span>
              ) : null}
            </section>
          ) : null}

          <main
            className={`workspace ${selectedState ? "with-inspector" : ""}`}
          >
            <section className="map-panel">
              <div className="map-toolbar">
                <div className="search-field">
                  <Search size={17} aria-hidden="true" />
                  <label className="sr-only" htmlFor="state-search">
                    Search states
                  </label>
                  <input
                    id="state-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search state, route, heading…"
                  />
                  {query ? (
                    <button
                      className="clear-search"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                </div>
                <div className="legend" aria-label="Graph legend">
                  <span>
                    <i className="root-dot" />
                    Entry
                  </span>
                  <span>
                    <i />
                    State
                  </span>
                  <span>
                    <i className="dead-dot" />
                    Dead end
                  </span>
                  <span>
                    <i className="risk-dot" />
                    Risk
                  </span>
                </div>
                <div className="graph-controls">
                  <button
                    onClick={() => graphRef.current?.zoomOut()}
                    aria-label="Zoom out"
                  >
                    <Minus size={17} />
                  </button>
                  <button
                    onClick={() => graphRef.current?.zoomIn()}
                    aria-label="Zoom in"
                  >
                    <Plus size={17} />
                  </button>
                  <button
                    onClick={() => graphRef.current?.fit()}
                    aria-label="Fit graph"
                  >
                    <Maximize2 size={17} />
                  </button>
                </div>
              </div>
              <GraphCanvas
                run={run}
                analysis={analysis}
                query={query}
                selectedStateId={selectedStateId}
                onSelectState={handleSelectState}
                graphRef={graphRef}
              />
              {run.stats.truncated ? (
                <div className="budget-notice">
                  Mapping stopped at the configured state budget. The graph is
                  partial.
                </div>
              ) : null}
            </section>
            {selectedState ? (
              <Inspector
                run={run}
                state={selectedState}
                comparisonRun={comparisonRun ?? undefined}
                comparisonState={comparisonState}
                onClose={() => setSelectedStateId(undefined)}
              />
            ) : null}
          </main>
        </>
      ) : null}
    </div>
  );
}
