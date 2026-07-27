import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium, firefox, webkit, type Locator, type Page } from "playwright";

import { StateScryError } from "./errors.js";
import { createFingerprint, normalizeUrl } from "./fingerprint.js";
import { shortestPath } from "./pathfinding.js";
import { redactText, redactUrl } from "./redaction.js";
import { actionAllowed, originAllowed, requestAllowed } from "./safety.js";
import { stateScryDirectory } from "./store.js";
import type {
  BehaviorRun,
  ReplayAssertion,
  ReplayDiagnostic,
  ReplayMismatch,
  ReplayResult,
  ReplayStep,
} from "./types.js";

export interface ReplayOptions {
  headless?: boolean;
  screenshotPath?: string;
  assertions?: ReplayAssertion[];
}
function browserFor(name: BehaviorRun["options"]["browser"]) {
  return name === "firefox" ? firefox : name === "webkit" ? webkit : chromium;
}
async function settle(page: Page, settleMs = 150): Promise<void> {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 2000 })
    .catch(() => undefined);
  await page.waitForTimeout(settleMs);
}

class ReplayActionError extends Error {
  constructor(
    message: string,
    readonly attemptedStrategies: string[],
  ) {
    super(message);
  }
}

function safeActionError(error: unknown, step: ReplayStep): string {
  let message = redactText(
    error instanceof Error ? error.message : String(error),
  );
  if (step.action.secretValue && step.action.value)
    message = message.replaceAll(step.action.value, "[REDACTED]");
  return message;
}

async function applyAction(locator: Locator, step: ReplayStep): Promise<void> {
  const action = step.action;
  if (action.kind === "fill") await locator.fill(action.value ?? "");
  else if (action.kind === "select")
    await locator.selectOption(action.value ?? "");
  else if (action.kind === "check") await locator.check();
  else await locator.click();
}

function constrainedFallback(
  page: Page,
  step: ReplayStep,
): { locator: Locator; strategy: string } | null {
  const action = step.action;
  if (action.configured || action.kind !== "click") return null;
  const role =
    action.tag === "a"
      ? "link"
      : ["button", "input"].includes(action.tag)
        ? "button"
        : null;
  if (!role || !action.label.trim()) return null;
  return {
    locator: page.getByRole(role, { name: action.label, exact: true }).first(),
    strategy: `exact ${role} role and accessible name`,
  };
}

async function execute(
  page: Page,
  step: ReplayStep,
): Promise<{ fallbackStrategy?: string; attemptedStrategies: string[] }> {
  const action = step.action;
  if (
    action.kind === "fill" &&
    action.secretValue &&
    action.value === undefined
  )
    throw new Error(
      "This replay path contains a redacted secret input. Supply the value through a fresh local mapping configuration before replaying it.",
    );
  if (action.kind === "press") {
    await page.keyboard.press(action.key ?? action.label);
    await settle(page);
    return { attemptedStrategies: ["keyboard"] };
  } else {
    const locator = page.locator(action.selector).first();
    const attemptedStrategies = [`CSS selector ${action.selector}`];
    try {
      await locator.waitFor({ state: "visible" });
      await applyAction(locator, step);
    } catch (primaryError) {
      const fallback = constrainedFallback(page, step);
      if (!fallback)
        throw new ReplayActionError(
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError),
          attemptedStrategies,
        );
      attemptedStrategies.push(fallback.strategy);
      try {
        await fallback.locator.waitFor({ state: "visible" });
        await applyAction(fallback.locator, step);
        await settle(page);
        return {
          fallbackStrategy: fallback.strategy,
          attemptedStrategies,
        };
      } catch (fallbackError) {
        throw new ReplayActionError(
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
          attemptedStrategies,
        );
      }
    }
  }
  await settle(page);
  return { attemptedStrategies: [`CSS selector ${action.selector}`] };
}
export function evaluateReplayValueAssertion(
  assertion: ReplayAssertion,
  values: { url: string; title: string; heading: string; text: string },
): ReplayMismatch | null {
  if (assertion.type === "selector")
    throw new StateScryError(
      "INVALID_ASSERTION",
      "Selector assertions require a browser page.",
    );
  const actual =
    assertion.type === "url"
      ? normalizeUrl(values.url)
      : assertion.type === "title"
        ? values.title
        : assertion.type === "heading"
          ? values.heading
          : values.text;
  const mode = assertion.mode ?? "equals";
  let passed = false;
  try {
    passed =
      mode === "contains"
        ? actual.includes(assertion.expected)
        : mode === "matches"
          ? new RegExp(assertion.expected).test(actual)
          : actual === assertion.expected;
  } catch {
    return {
      field: "assertion",
      expected: assertion.expected,
      actual,
      message: `Configured ${assertion.type} assertion has an invalid regular expression.`,
    };
  }
  return passed
    ? null
    : {
        field: "assertion",
        expected: assertion.expected,
        actual,
        message: `Configured ${assertion.type} assertion failed.`,
      };
}

function assertionMismatch(
  assertion: ReplayAssertion,
  url: string,
  title: string,
  heading: string,
  text: string,
  page: Page,
): Promise<ReplayMismatch | null> {
  if (assertion.type === "selector")
    return page
      .locator(assertion.selector ?? "")
      .first()
      .isVisible()
      .then((visible): ReplayMismatch | null =>
        visible
          ? null
          : {
              field: "assertion",
              expected: assertion.selector ?? "",
              actual: "not visible",
              message: "Configured selector assertion failed.",
            },
      )
      .catch((): ReplayMismatch => ({
        field: "assertion",
        expected: assertion.selector ?? "",
        actual: "not found",
        message: "Configured selector assertion failed.",
      }));
  return Promise.resolve(
    evaluateReplayValueAssertion(assertion, { url, title, heading, text }),
  );
}

export async function replayState(
  run: BehaviorRun,
  stateId: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const state = run.states.find((candidate) => candidate.id === stateId);
  if (!state)
    throw new StateScryError(
      "STATE_NOT_FOUND",
      "Run " + run.id + " has no state named " + stateId + ".",
    );
  const path = shortestPath(run, stateId);
  if (!path)
    throw new StateScryError(
      "STATE_UNREACHABLE",
      "State " + stateId + " has no reproducible discovered path.",
    );
  const browser = await browserFor(run.options.browser).launch({
    headless: options.headless ?? true,
  });
  const context = await browser.newContext({
    viewport: { width: run.viewport.width, height: run.viewport.height },
    ...(run.persona.storageStatePath
      ? { storageState: run.persona.storageStatePath }
      : {}),
  });
  const blockedRequests: Array<{
    method: string;
    url: string;
    reason: string;
  }> = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const policy = requestAllowed(
      request.method(),
      request.url(),
      run.options.explorationMode,
      run.options.mutationAllowlist,
    );
    if (!policy.allowed) {
      blockedRequests.push({
        method: request.method(),
        url: redactUrl(request.url()),
        reason: policy.reason ?? "Blocked by request policy.",
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (
      request.isNavigationRequest() &&
      !originAllowed(request.url(), run.options.allowedOrigins)
    ) {
      blockedRequests.push({
        method: request.method(),
        url: redactUrl(request.url()),
        reason: "Navigation origin is not allowed by this run.",
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const screenshotPath =
    options.screenshotPath ??
    resolve(
      stateScryDirectory(run.projectRoot),
      "replays",
      run.id + "-" + state.id + ".png",
    );
  const accessibilityPath = screenshotPath.replace(/\.png$/i, ".yaml");
  await mkdir(dirname(screenshotPath), { recursive: true });
  const mismatches: ReplayMismatch[] = [];
  const diagnostics: ReplayDiagnostic[] = [];
  try {
    try {
      await page.goto(run.baseUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mismatches.push({
        field: "action",
        expected: `navigate to ${run.baseUrl}`,
        actual: message,
        message: "Replay could not open the recorded application entry URL.",
      });
      diagnostics.push({
        stage: "navigation",
        code: "NAVIGATION_FAILED",
        severity: "error",
        message,
        recommendation:
          "Start the application, verify the recorded base URL, and retry replay.",
      });
    }
    await settle(page, run.options.settleMs);
    for (const [stepIndex, step] of path.entries()) {
      if (diagnostics.some((item) => item.code === "NAVIGATION_FAILED")) break;
      try {
        const policy = actionAllowed(step.action, run.options.explorationMode);
        if (!policy.allowed) {
          mismatches.push({
            field: "action",
            expected: step.action.label,
            actual: policy.reason ?? "blocked",
            message: "Replay action was blocked by the run's safety policy.",
          });
          diagnostics.push({
            stage: "action",
            code: "ACTION_BLOCKED",
            severity: "error",
            message: policy.reason ?? "Replay action was blocked.",
            stepIndex,
            selector: step.action.selector,
            recommendation:
              "Review the recorded action and configure an explicit policy only if this mutation is safe in the test environment.",
          });
          break;
        }
        const execution = await execute(page, step);
        if (execution.fallbackStrategy)
          diagnostics.push({
            stage: "action",
            code: "LOCATOR_FALLBACK_USED",
            severity: "warning",
            message: `The recorded selector failed; replay used ${execution.fallbackStrategy}.`,
            stepIndex,
            selector: step.action.selector,
            attemptedStrategies: execution.attemptedStrategies,
            recommendation:
              "Refresh the behavior map so the persisted selector reflects the current application.",
          });
      } catch (error) {
        mismatches.push({
          field: "action",
          expected: step.action.label,
          actual: safeActionError(error, step),
          message:
            "Replay action failed before the expected state was reached.",
        });
        diagnostics.push({
          stage: "action",
          code: "ACTION_FAILED",
          severity: "error",
          message: safeActionError(error, step),
          stepIndex,
          selector: step.action.selector,
          attemptedStrategies:
            error instanceof ReplayActionError
              ? error.attemptedStrategies
              : [step.action.selector],
          recommendation:
            "Inspect the screenshot and accessibility evidence, then refresh the selector or add a stable data-testid.",
        });
        break;
      }
    }
    const title = await page.title();
    const heading = await page
      .locator("h1, [role=heading]")
      .first()
      .innerText({ timeout: 500 })
      .catch(() => "");
    const accessibilitySnapshot = await page
      .locator("body")
      .ariaSnapshot()
      .catch(() => "");
    const fingerprint = createFingerprint({
      url: page.url(),
      title,
      heading,
      accessibilitySnapshot,
      role: run.persona.role,
      viewport: run.viewport,
      featureContext: run.featureContext,
      ...(run.options.ignoredTextPatterns
        ? { ignoredTextPatterns: run.options.ignoredTextPatterns }
        : {}),
    }).fingerprint;
    if (fingerprint !== state.fingerprint)
      mismatches.push({
        field: "fingerprint",
        expected: state.fingerprint,
        actual: fingerprint,
        message: "Final state fingerprint differs from the recorded state.",
      });
    if (normalizeUrl(page.url()) !== state.normalizedUrl)
      mismatches.push({
        field: "url",
        expected: state.normalizedUrl,
        actual: normalizeUrl(page.url()),
        message: "Final normalized URL differs from the recorded state.",
      });
    if (title !== state.title)
      mismatches.push({
        field: "title",
        expected: state.title,
        actual: title,
        message: "Final title differs from the recorded state.",
      });
    if (heading !== state.heading)
      mismatches.push({
        field: "heading",
        expected: state.heading,
        actual: heading,
        message: "Final heading differs from the recorded state.",
      });
    if (mismatches.some((mismatch) => mismatch.field !== "action"))
      diagnostics.push({
        stage: "verification",
        code: "FINAL_STATE_MISMATCH",
        severity: "error",
        message:
          "The browser completed available actions but did not match every recorded final-state signal.",
        recommendation:
          "Review mismatch fields and evidence; remap only if the application behavior changed intentionally.",
      });
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    for (const assertion of options.assertions ?? []) {
      const mismatch = await assertionMismatch(
        assertion,
        page.url(),
        title,
        heading,
        text,
        page,
      );
      if (mismatch) mismatches.push(mismatch);
    }
    for (const blocked of blockedRequests) {
      mismatches.push({
        field: "action",
        expected: "network request allowed",
        actual: `${blocked.method} ${blocked.url}`,
        message: blocked.reason,
      });
      diagnostics.push({
        stage: "network",
        code: "REQUEST_BLOCKED",
        severity: "error",
        message: `${blocked.method} ${blocked.url}: ${blocked.reason}`,
        recommendation:
          "Keep the request blocked unless it is an explicitly approved test-environment mutation.",
      });
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(accessibilityPath, accessibilitySnapshot + "\n", "utf8");
    return {
      status: mismatches.length === 0 ? "verified" : "failed",
      requestedStateId: state.id,
      requestedUrl: state.url,
      finalUrl: page.url(),
      title,
      heading,
      fingerprint,
      steps: path.length,
      attempts: 1,
      mismatches,
      diagnostics,
      evidence: { screenshotPath, accessibilityPath },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
