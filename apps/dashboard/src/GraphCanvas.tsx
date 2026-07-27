import { memo, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";

import type { BehaviorRun, RunAnalysis } from "@statescry-tool/core";

export interface GraphHandle {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface GraphCanvasProps {
  run: BehaviorRun;
  analysis: RunAnalysis;
  query: string;
  selectedStateId: string | undefined;
  onSelectState: (stateId: string) => void;
  graphRef: Ref<GraphHandle>;
}

function GraphCanvasComponent({
  run,
  analysis,
  query,
  selectedStateId,
  onSelectState,
  graphRef,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cytoscapeRef = useRef<Core | null>(null);
  const deadEnds = new Set(
    (analysis.terminalStates ?? analysis.deadEnds ?? []).map(
      (state) => state.id,
    ),
  );
  const risky = new Set(analysis.permissionRisks.map((risk) => risk.stateId));
  const needle = query.toLowerCase();
  const visibleStates = run.states.filter((state) =>
    `${state.url} ${state.title} ${state.heading} ${state.textSample}`
      .toLowerCase()
      .includes(needle),
  );

  useImperativeHandle(graphRef, () => ({
    fit: () => cytoscapeRef.current?.fit(undefined, 52),
    zoomIn: () => {
      const graph = cytoscapeRef.current;
      if (graph) graph.zoom(graph.zoom() * 1.2);
    },
    zoomOut: () => {
      const graph = cytoscapeRef.current;
      if (graph) graph.zoom(graph.zoom() / 1.2);
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const visibleIds = new Set(visibleStates.map((state) => state.id));
    const elements: ElementDefinition[] = [
      ...visibleStates.map((state) => ({
        data: {
          id: state.id,
          label:
            state.heading || state.title || new URL(state.url).pathname || "/",
          depth: state.depth,
          kind:
            state.depth === 0
              ? "root"
              : risky.has(state.id)
                ? "risk"
                : deadEnds.has(state.id)
                  ? "dead-end"
                  : "state",
        },
      })),
      ...run.transitions
        .filter(
          (transition) =>
            visibleIds.has(transition.source) &&
            visibleIds.has(transition.target),
        )
        .map((transition) => ({
          data: {
            id: transition.id,
            source: transition.source,
            target: transition.target,
            label: transition.action.label,
          },
        })),
    ];

    const graph = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.18,
      selectionType: "single",
      style: [
        {
          selector: "node",
          style: {
            width: 34,
            height: 34,
            label: "data(label)",
            "font-family": "Fira Sans, Inter, system-ui, sans-serif",
            "font-size": 10,
            "font-weight": "normal",
            color: "#cbd5e1",
            "text-valign": "bottom",
            "text-margin-y": 8,
            "text-max-width": "112px",
            "text-wrap": "ellipsis",
            "background-color": "#64748b",
            "border-width": 4,
            "border-color": "#1e293b",
            "overlay-opacity": 0,
          },
        },
        {
          selector: 'node[kind = "root"]',
          style: {
            "background-color": "#22c55e",
            "border-color": "#14532d",
            width: 42,
            height: 42,
          },
        },
        {
          selector: 'node[kind = "dead-end"]',
          style: {
            "background-color": "#f59e0b",
            "border-color": "#78350f",
          },
        },
        {
          selector: 'node[kind = "risk"]',
          style: {
            "background-color": "#ef4444",
            "border-color": "#7f1d1d",
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-color": "#f8fafc",
            "border-width": 5,
            "underlay-color": "#22c55e",
            "underlay-opacity": 0.22,
            "underlay-padding": 9,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#334155",
            "target-arrow-color": "#475569",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 0.75,
            "overlay-opacity": 0,
          },
        },
        {
          selector: "edge:selected",
          style: {
            width: 2.5,
            "line-color": "#22c55e",
            "target-arrow-color": "#22c55e",
          },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        fit: true,
        padding: 56,
        nodeRepulsion: () => 160_000,
        idealEdgeLength: () => 110,
      },
    });
    cytoscapeRef.current = graph;
    graph.on("tap", "node", (event) => {
      onSelectState(event.target.id());
    });
    if (selectedStateId) {
      graph.getElementById(selectedStateId).select();
    }

    return () => {
      graph.destroy();
      cytoscapeRef.current = null;
    };
  }, [analysis, onSelectState, query, run, selectedStateId]);

  return (
    <>
      <div
        ref={containerRef}
        className="graph-canvas"
        role="img"
        aria-label={`Behavior graph showing ${visibleStates.length} of ${run.states.length} states`}
      />
      <nav className="state-index" aria-label="Graph states">
        <header>
          <strong>States</strong>
          <span>
            {visibleStates.length}/{run.states.length}
          </span>
        </header>
        <ul>
          {visibleStates.map((state) => (
            <li key={state.id}>
              <button
                type="button"
                aria-current={selectedStateId === state.id ? "true" : undefined}
                onClick={() => onSelectState(state.id)}
              >
                <span>{state.heading || state.title || "Unnamed state"}</span>
                <small>{new URL(state.url).pathname || "/"}</small>
              </button>
            </li>
          ))}
        </ul>
        {visibleStates.length === 0 ? <p>No matching states.</p> : null}
      </nav>
    </>
  );
}

export const GraphCanvas = memo(GraphCanvasComponent);
