import type { BehaviorRun, ReplayStep, StateNode } from "./types.js";

export function shortestPath(
  run: BehaviorRun,
  targetStateId: string,
): ReplayStep[] | null {
  const target = run.states.find((state) => state.id === targetStateId);
  if (!target) {
    return null;
  }

  const root = run.states.find((state) => state.depth === 0);
  if (!root || root.id === targetStateId) {
    return [];
  }

  const edges = new Map<string, typeof run.transitions>();
  for (const transition of run.transitions) {
    const existing = edges.get(transition.source) ?? [];
    existing.push(transition);
    edges.set(transition.source, existing);
  }

  const queue: Array<{ stateId: string; path: ReplayStep[] }> = [
    { stateId: root.id, path: [] },
  ];
  const seen = new Set([root.id]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    for (const transition of edges.get(current.stateId) ?? []) {
      if (seen.has(transition.target)) continue;
      const path = [
        ...current.path,
        { action: transition.action, sourceStateId: transition.source },
      ];
      if (transition.target === targetStateId) {
        return path;
      }
      seen.add(transition.target);
      queue.push({ stateId: transition.target, path });
    }
  }

  return target.path.length > 0 ? target.path : null;
}

export function summarizeState(state: StateNode) {
  return {
    id: state.id,
    url: state.url,
    title: state.title,
    heading: state.heading,
    role: state.role,
    viewport: state.viewport.name,
    depth: state.depth,
  };
}
