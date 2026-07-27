import { summarizeRun } from "./diff.js";
import { summarizeState } from "./pathfinding.js";
import type {
  BehaviorRun,
  PermissionRisk,
  RoleAccessDiff,
  RunAnalysis,
  StateNode,
} from "./types.js";

const SENSITIVE_UI =
  /\b(admin|refund|user management|roles?|permissions?|secrets?|tokens?|api keys?|delete account|payout)\b/i;
const PRIVILEGED_ROLE = /\b(admin|owner|superuser|root)\b/i;

function findCycles(run: BehaviorRun): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const transition of run.transitions) {
    const list = adjacency.get(transition.source) ?? [];
    list.push(transition.target);
    adjacency.set(transition.source, list);
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const cycles: string[][] = [];

  const visit = (stateId: string) => {
    indices.set(stateId, index);
    lowLinks.set(stateId, index);
    index += 1;
    stack.push(stateId);
    onStack.add(stateId);

    for (const next of adjacency.get(stateId) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        lowLinks.set(
          stateId,
          Math.min(lowLinks.get(stateId) ?? 0, lowLinks.get(next) ?? 0),
        );
      } else if (onStack.has(next)) {
        lowLinks.set(
          stateId,
          Math.min(lowLinks.get(stateId) ?? 0, indices.get(next) ?? 0),
        );
      }
    }

    if (lowLinks.get(stateId) === indices.get(stateId)) {
      const component: string[] = [];
      let current: string | undefined;
      do {
        current = stack.pop();
        if (!current) break;
        onStack.delete(current);
        component.push(current);
      } while (current !== stateId);

      const selfLoop =
        component.length === 1 &&
        (adjacency.get(component[0] ?? "") ?? []).includes(component[0] ?? "");
      if (component.length > 1 || selfLoop) {
        cycles.push(component);
      }
    }
  };

  for (const state of run.states) {
    if (!indices.has(state.id)) {
      visit(state.id);
    }
  }
  return cycles;
}

function findPermissionRisks(run: BehaviorRun): PermissionRisk[] {
  if (PRIVILEGED_ROLE.test(run.persona.role)) {
    return [];
  }

  return run.states.flatMap((state) => {
    const content = `${state.title} ${state.heading} ${state.textSample}`;
    const match = SENSITIVE_UI.exec(content);
    SENSITIVE_UI.lastIndex = 0;
    return match
      ? [
          {
            stateId: state.id,
            role: state.role,
            label: match[0],
            reason: `A non-privileged persona can reach UI containing “${match[0]}”. Review the authorization boundary.`,
          },
        ]
      : [];
  });
}

export function analyzeRun(run: BehaviorRun): RunAnalysis {
  const terminalStates = run.states
    .filter((state) => state.coverageStatus === "terminal")
    .map(summarizeState);
  const legacyDeadEnds = terminalStates.length
    ? terminalStates
    : run.states
        .filter(
          (state) =>
            state.depth > 0 &&
            !run.transitions.some(
              (transition) => transition.source === state.id,
            ),
        )
        .map(summarizeState);
  const limitedStates = run.states
    .filter(
      (state) =>
        state.coverageStatus &&
        state.coverageStatus !== "terminal" &&
        state.coverageStatus !== "explored",
    )
    .map(summarizeState);

  return {
    runId: run.id,
    terminalStates,
    deadEnds: legacyDeadEnds,
    limitedStates,
    reachability: {
      assessed: false,
      reason:
        "A black-box crawl cannot prove a state is unreachable without a declared state inventory.",
    },
    cycles: findCycles(run),
    permissionRisks: findPermissionRisks(run),
    blockedActions: run.states.flatMap((state) =>
      state.blockedActions.map((action) => ({ stateId: state.id, action })),
    ),
  };
}

function accessKey(state: StateNode): string {
  const path = new URL(state.normalizedUrl).pathname;
  return `${path}|${state.title.toLowerCase()}|${state.heading.toLowerCase()}`;
}

export function compareRoleAccess(
  lessPrivileged: BehaviorRun,
  privileged: BehaviorRun,
): RoleAccessDiff {
  const privilegedByKey = new Map(
    privileged.states.map((state) => [accessKey(state), state]),
  );
  const lessPrivilegedByKey = new Map(
    lessPrivileged.states.map((state) => [accessKey(state), state]),
  );
  const sharedStates: RoleAccessDiff["sharedStates"] = [];
  const suspiciousExposure: PermissionRisk[] = [];
  const sharedKeys = new Set<string>();

  for (const state of lessPrivileged.states) {
    const key = accessKey(state);
    const privilegedState = privilegedByKey.get(key);
    if (privilegedState && !sharedKeys.has(key)) {
      sharedKeys.add(key);
      sharedStates.push({
        accessKey: key,
        lessPrivileged: summarizeState(state),
        privileged: summarizeState(privilegedState),
        confidence:
          state.normalizedUrl === privilegedState.normalizedUrl ? 1 : 0.8,
      });
    }
    const content = `${state.title} ${state.heading} ${state.textSample}`;
    const match = SENSITIVE_UI.exec(content);
    SENSITIVE_UI.lastIndex = 0;
    if (
      match &&
      (privilegedState || PRIVILEGED_ROLE.test(privileged.persona.role))
    ) {
      suspiciousExposure.push({
        stateId: state.id,
        role: state.role,
        label: match[0],
        reason: `The ${lessPrivileged.persona.role} persona can reach privileged-looking UI also associated with the ${privileged.persona.role} map.`,
      });
    }
  }

  return {
    lessPrivilegedRun: summarizeRun(lessPrivileged),
    privilegedRun: summarizeRun(privileged),
    sharedStates,
    suspiciousExposure,
    privilegedOnly: privileged.states
      .filter((state) => !lessPrivilegedByKey.has(accessKey(state)))
      .map(summarizeState),
    limitations: [
      "This compares observed UI state, not server-side authorization. Verify protected API endpoints independently.",
    ],
  };
}
