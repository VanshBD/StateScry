import { createHash } from "node:crypto";

import type {
  ActionDescriptor,
  ExplorationMode,
  MutationAllowRule,
  RiskLevel,
} from "./types.js";

const BLOCKED_ACTION =
  /\b(delete|destroy|remove|erase|purchase|buy|pay|place order|transfer|send money|publish|deploy|terminate|revoke|drop|reset account)\b/i;
const REVIEW_ACTION =
  /\b(submit|save|confirm|approve|invite|create|update|sign out|logout)\b/i;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function classifyAction(
  label: string,
  tag = "",
  href?: string,
  formMethod?: string,
): { risk: RiskLevel; reason?: string } {
  if (
    BLOCKED_ACTION.test(label) ||
    (formMethod && MUTATING_METHODS.has(formMethod.toUpperCase()))
  )
    return {
      risk: "blocked",
      reason:
        "The action matches the local destructive or mutating-action policy.",
    };
  if (
    REVIEW_ACTION.test(label) ||
    tag === "form" ||
    (href && !href.startsWith("http"))
  )
    return {
      risk: "review",
      reason:
        "The action may alter application state and is not proven safe by its label.",
    };
  return { risk: "safe" };
}

interface CandidateAction {
  selector: string;
  label: string;
  tag: string;
  href?: string;
  formMethod?: string;
}
export function toActionDescriptor(
  candidate: CandidateAction,
): ActionDescriptor {
  const classification = classifyAction(
    candidate.label,
    candidate.tag,
    candidate.href,
    candidate.formMethod,
  );
  const input =
    candidate.selector + "\n" + candidate.label + "\n" + (candidate.href ?? "");
  return {
    id:
      "action_" + createHash("sha256").update(input).digest("hex").slice(0, 16),
    kind: "click",
    selector: candidate.selector,
    label: candidate.label,
    tag: candidate.tag,
    risk: classification.risk,
    ...(candidate.href ? { href: candidate.href } : {}),
    ...(classification.reason ? { blockedReason: classification.reason } : {}),
  };
}

export function originAllowed(
  target: string,
  allowedOrigins: readonly string[],
): boolean {
  try {
    const url = new URL(target);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      allowedOrigins.includes(url.origin)
    );
  } catch {
    return false;
  }
}
export function requestAllowed(
  method: string,
  url: string,
  mode: ExplorationMode,
  allowlist: readonly MutationAllowRule[],
): { allowed: boolean; reason?: string } {
  const upper = method.toUpperCase();
  if (!MUTATING_METHODS.has(upper)) return { allowed: true };
  const match = allowlist.find((rule) => {
    if (rule.method.toUpperCase() !== upper) return false;
    try {
      return new RegExp(
        "^" +
          rule.urlPattern
            .split("*")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
      ).test(url);
    } catch {
      return false;
    }
  });
  if (mode === "allowlist" && match) return { allowed: true };
  return {
    allowed: false,
    reason:
      mode === "observe"
        ? "Observe mode blocks non-idempotent network requests."
        : "No explicit mutation allowlist rule matched this request.",
  };
}

export function actionAllowed(
  action: ActionDescriptor,
  mode: ExplorationMode,
): { allowed: boolean; reason?: string } {
  if (action.risk === "blocked")
    return {
      allowed: false,
      reason: action.blockedReason ?? "Blocked by action policy.",
    };
  if (mode === "observe" && action.risk === "review")
    return {
      allowed: false,
      reason:
        "Observe mode requires an explicitly configured custom action for review-risk interactions.",
    };
  return { allowed: true };
}
