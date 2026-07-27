import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import { errorMessage } from "./errors.js";
import {
  prepareExtensionRuntime,
  type ExtensionRuntime,
} from "./extensions.js";
import { collectFrameworkSignals } from "./adapters.js";
import { createFingerprint, sha256 } from "./fingerprint.js";
import { planIncrementalExploration } from "./incremental.js";
import { executeCommandHook } from "./hooks.js";
import { redactRecord, redactText, redactUrl } from "./redaction.js";
import {
  actionAllowed,
  originAllowed,
  requestAllowed,
  toActionDescriptor,
} from "./safety.js";
import { runDirectory, saveRun } from "./store.js";
import {
  STATESCRY_SCHEMA_VERSION,
  type ActionDescriptor,
  type BehaviorRun,
  type ConsoleEntry,
  type ExploreOptions,
  type HttpError,
  type NetworkFailure,
  type ProgressListener,
  type ReplayStep,
  type StateNode,
  type Transition,
} from "./types.js";

const execFileAsync = promisify(execFile);

interface CandidateAction {
  selector: string;
  label: string;
  tag: string;
  href?: string;
}

interface QueueItem {
  path: ReplayStep[];
  parentStateId?: string;
  action?: ActionDescriptor;
}

interface PageSignals {
  console: ConsoleEntry[];
  networkFailures: NetworkFailure[];
  httpErrors: HttpError[];
  blockedRequests: Array<{ url: string; method: string; reason: string }>;
}

function report(
  listener: ProgressListener | undefined,
  phase: Parameters<ProgressListener>[0]["phase"],
  message: string,
  states: number,
  transitions: number,
): void {
  listener?.({ phase, message, states, transitions });
}

async function detectCommit(projectRoot: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      windowsHide: true,
      timeout: 2_000,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function browserFor(name: ExploreOptions["browser"]) {
  if (name === "firefox") return firefox;
  if (name === "webkit") return webkit;
  return chromium;
}

async function createContext(
  browser: Browser,
  options: ExploreOptions,
): Promise<{
  context: BrowserContext;
  blockedRequests: PageSignals["blockedRequests"];
}> {
  const blockedRequests: PageSignals["blockedRequests"] = [];
  const context = await browser.newContext({
    viewport: {
      width: options.viewport.width,
      height: options.viewport.height,
    },
    ...(options.persona.storageStatePath
      ? { storageState: options.persona.storageStatePath }
      : {}),
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestPolicy = requestAllowed(
      request.method(),
      request.url(),
      options.explorationMode,
      options.mutationAllowlist,
    );
    if (!requestPolicy.allowed) {
      blockedRequests.push({
        url: redactUrl(request.url()),
        method: request.method(),
        reason: requestPolicy.reason ?? "Blocked by request policy.",
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (
      request.isNavigationRequest() &&
      !originAllowed(request.url(), options.allowedOrigins)
    ) {
      blockedRequests.push({
        url: redactUrl(request.url()),
        method: request.method(),
        reason: "Navigation origin is not included in allowedOrigins.",
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return { context, blockedRequests };
}

function attachSignals(
  page: Page,
  blockedRequests: PageSignals["blockedRequests"],
): PageSignals {
  const signals: PageSignals = {
    console: [],
    networkFailures: [],
    httpErrors: [],
    blockedRequests,
  };
  page.on("console", (message) => {
    signals.console.push({
      type: message.type(),
      text: redactText(message.text()).slice(0, 2_000),
    });
  });
  page.on("requestfailed", (request) => {
    signals.networkFailures.push({
      url: redactUrl(request.url()),
      method: request.method(),
      error: redactText(request.failure()?.errorText ?? "Request failed"),
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      signals.httpErrors.push({
        url: redactUrl(response.url()),
        method: response.request().method(),
        status: response.status(),
      });
    }
  });
  return signals;
}

async function settle(page: Page, settleMs = 150): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(settleMs);
}

async function waitForStableState(
  page: Page,
  options: ExploreOptions,
): Promise<void> {
  await settle(page, options.settleMs);
  for (const selector of options.waitForSelectors) {
    await page
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout: options.actionTimeoutMs });
  }
}

async function executeStep(
  page: Page,
  step: ReplayStep,
  timeoutMs: number,
): Promise<void> {
  const locator = page.locator(step.action.selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  if (step.action.kind === "fill")
    await locator.fill(step.action.value ?? "", { timeout: timeoutMs });
  else if (step.action.kind === "select")
    await locator.selectOption(step.action.value ?? "", { timeout: timeoutMs });
  else if (step.action.kind === "check")
    await locator.check({ timeout: timeoutMs });
  else if (step.action.kind === "press")
    await page.keyboard.press(step.action.key ?? step.action.label);
  else await locator.click({ timeout: timeoutMs });
}

function configuredSteps(options: ExploreOptions): ReplayStep[] {
  return [
    ...options.inputs.map((input) => ({
      action: {
        id: `configured_fill_${sha256(input.selector).slice(0, 12)}`,
        kind: "fill" as const,
        selector: input.selector,
        label: input.label ?? `Fill ${input.selector}`,
        tag: "input",
        value: input.value,
        risk: "safe" as const,
        configured: true,
        ...(input.secret ? { secretValue: true } : {}),
      },
    })),
    ...options.customActions.map((action) => ({
      action: {
        id: `configured_${action.kind}_${sha256(action.name).slice(0, 12)}`,
        kind: action.kind,
        selector: action.selector ?? "body",
        label: action.label ?? action.name,
        tag: "configured",
        ...(action.value !== undefined ? { value: action.value } : {}),
        ...(action.key !== undefined ? { key: action.key } : {}),
        risk: action.allowInObserveMode
          ? ("safe" as const)
          : ("review" as const),
        configured: true,
      },
    })),
  ];
}

async function discoverActions(page: Page): Promise<CandidateAction[]> {
  return page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, [role="button"], input[type="submit"], input[type="button"], [data-statescry-action]',
      ),
    );

    const selectorFor = (element: HTMLElement): string => {
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
      const statescry = element.getAttribute("data-statescry-action");
      if (statescry)
        return `[data-statescry-action="${CSS.escape(statescry)}"]`;
      if (element.id) return `#${CSS.escape(element.id)}`;
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;
      const name = element.getAttribute("name");
      if (name) {
        return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      }

      const parts: string[] = [];
      let current: HTMLElement | null = element;
      while (current && current !== document.body && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === current?.tagName,
            )
          : [];
        const suffix =
          siblings.length > 1
            ? `:nth-of-type(${siblings.indexOf(current) + 1})`
            : "";
        parts.unshift(`${tag}${suffix}`);
        current = current.parentElement;
      }
      return `body > ${parts.join(" > ")}`;
    };

    const visible = (element: HTMLElement): boolean => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-disabled") !== "true"
      );
    };

    const results: CandidateAction[] = [];
    const seen = new Set<string>();
    for (const element of elements) {
      if (!visible(element)) continue;
      const label = (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        (element instanceof HTMLInputElement ? element.value : "") ||
        element.innerText
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      if (!label) continue;
      const selector = selectorFor(element);
      if (seen.has(selector)) continue;
      seen.add(selector);
      const href =
        element instanceof HTMLAnchorElement ? element.href : undefined;
      const form = element.closest("form");
      results.push({
        selector,
        label,
        tag: element.tagName.toLowerCase(),
        ...(href ? { href } : {}),
        ...(form
          ? { formMethod: (form.getAttribute("method") ?? "GET").toUpperCase() }
          : {}),
      });
      if (results.length >= 60) break;
    }
    return results;
  });
}

async function captureState(
  page: Page,
  options: ExploreOptions,
  path: ReplayStep[],
  signals: PageSignals,
  adapterWarnings: Set<string>,
  extensions: ExtensionRuntime,
): Promise<{ state: StateNode; candidates: ActionDescriptor[] }> {
  const title = (
    await extensions.redact("title", redactText(await page.title()))
  ).slice(0, 500);
  const body = page.locator("body");
  const accessibilitySnapshot = (
    await extensions.redact(
      "accessibility",
      redactText(await body.ariaSnapshot({ timeout: options.actionTimeoutMs })),
    )
  ).slice(0, 100_000);
  const textSample = (
    await extensions.redact("body", redactText(await body.innerText()))
  ).slice(0, 8_000);
  const heading = (
    await extensions.redact(
      "heading",
      redactText(
        await page
          .locator("h1, [role=heading]")
          .first()
          .innerText({ timeout: 500 })
          .catch(() => ""),
      ),
    )
  ).slice(0, 500);
  const framework = await collectFrameworkSignals(
    page,
    options.frameworkAdapters ?? [],
  );
  for (const warning of framework.warnings) adapterWarnings.add(warning);
  const frameworkSignals = redactRecord(framework.signals);
  const fingerprint = createFingerprint({
    url: page.url(),
    title,
    heading,
    accessibilitySnapshot,
    role: options.persona.role,
    viewport: options.viewport,
    featureContext: {
      ...redactRecord(options.featureContext),
      ...Object.fromEntries(
        Object.entries(frameworkSignals).map(([key, value]) => [
          `framework:${key}`,
          value,
        ]),
      ),
    },
    ignoredTextPatterns: options.ignoredTextPatterns,
  });
  const extensionActions = await extensions.actions({
    url: redactUrl(page.url()),
    title,
    heading,
    textSample,
    role: options.persona.role,
    viewport: options.viewport,
    featureContext: redactRecord(options.featureContext),
  });
  const candidates = [
    ...configuredSteps(options).map((step) => step.action),
    ...extensionActions,
    ...(await discoverActions(page)).map(toActionDescriptor),
  ].slice(0, options.maxActionsPerState);
  const blockedActions = candidates.flatMap((action) => {
    const policy = actionAllowed(action, options.explorationMode);
    if (!policy.allowed)
      return [
        {
          ...action,
          blockedReason:
            policy.reason ??
            action.blockedReason ??
            "Blocked by action policy.",
        },
      ];
    if (action.href && !originAllowed(action.href, options.allowedOrigins))
      return [
        {
          ...action,
          risk: "blocked" as const,
          blockedReason: "Navigation origin is not included in allowedOrigins.",
        },
      ];
    return [];
  });
  const screenshotRelative = `screenshots/${fingerprint.id}.png`;
  const accessibilityRelative = `accessibility/${fingerprint.id}.yaml`;

  const state: StateNode = {
    id: fingerprint.id,
    fingerprint: fingerprint.fingerprint,
    logicalKey: fingerprint.logicalKey,
    url: redactUrl(page.url()),
    normalizedUrl: fingerprint.normalizedUrl,
    title,
    heading,
    textSample,
    accessibilitySnapshot,
    persona: options.persona.name,
    role: options.persona.role,
    viewport: options.viewport,
    featureContext: redactRecord(options.featureContext),
    depth: path.length,
    path: path.map((step) => {
      if (!step.action.secretValue) return step;
      const { value: _secretValue, ...redactedAction } = step.action;
      return { ...step, action: redactedAction };
    }),
    discoveredAt: new Date().toISOString(),
    evidence: {
      ...(options.evidenceMode !== "metadata"
        ? { screenshotPath: screenshotRelative }
        : {}),
      ...(options.evidenceMode === "full"
        ? { tracePath: `traces/${fingerprint.id}.zip` }
        : {}),
      accessibilityPath: accessibilityRelative,
      console: signals.console.slice(-100),
      networkFailures: signals.networkFailures.slice(-100),
      blockedRequests: signals.blockedRequests.slice(-100),
      httpErrors: signals.httpErrors.slice(-100),
    },
    outgoingActionCount: candidates.length - blockedActions.length,
    blockedActions,
    coverageStatus:
      path.length >= options.maxDepth
        ? "depth_limited"
        : blockedActions.length > 0 &&
            candidates.length === blockedActions.length
          ? "policy_limited"
          : candidates.length === 0
            ? "terminal"
            : "explored",
    ...(path.length >= options.maxDepth
      ? { coverageReason: "Configured maximum depth reached." }
      : blockedActions.length > 0 && candidates.length === blockedActions.length
        ? { coverageReason: "All discovered actions were blocked by policy." }
        : {}),
    ...(Object.keys(frameworkSignals).length > 0 ? { frameworkSignals } : {}),
    provenance: { kind: "observed" },
  };
  return { state, candidates };
}

async function copyReusedEvidence(
  prior: BehaviorRun,
  runRoot: string,
  states: StateNode[],
): Promise<void> {
  const priorRoot = runDirectory(prior.projectRoot, prior.id);
  const paths = new Set(
    states.flatMap((state) =>
      [
        state.evidence.screenshotPath,
        state.evidence.accessibilityPath,
        state.evidence.tracePath,
      ].filter((path): path is string => Boolean(path)),
    ),
  );
  for (const path of [...paths].sort()) {
    const destination = resolve(runRoot, path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(resolve(priorRoot, path), destination).catch(
      () => undefined,
    );
  }
}

async function persistStateEvidence(
  page: Page,
  runRoot: string,
  state: StateNode,
): Promise<void> {
  if (state.evidence.screenshotPath)
    await mkdir(resolve(runRoot, "screenshots"), { recursive: true });
  await mkdir(resolve(runRoot, "accessibility"), { recursive: true });
  await Promise.all([
    ...(state.evidence.screenshotPath
      ? [
          page.screenshot({
            path: resolve(runRoot, state.evidence.screenshotPath),
            fullPage: true,
          }),
        ]
      : []),
    writeFile(
      resolve(runRoot, state.evidence.accessibilityPath!),
      `${state.accessibilitySnapshot}\n`,
      "utf8",
    ),
  ]);
}

function transitionFor(
  source: string,
  target: string,
  action: ActionDescriptor,
): Transition {
  const hash = sha256(`${source}\n${target}\n${action.id}`).slice(0, 16);
  const persistedAction = (() => {
    if (!action.secretValue) return action;
    const { value: _secretValue, ...redactedAction } = action;
    return redactedAction;
  })();
  return {
    id: `transition_${hash}`,
    source,
    target,
    action: persistedAction,
    discoveredAt: new Date().toISOString(),
  };
}

export async function exploreApplication(
  options: ExploreOptions,
  onProgress?: ProgressListener,
): Promise<BehaviorRun> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const id = `run_${startedAt.replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const name =
    options.name ??
    `${options.persona.name}-${options.viewport.name}-${startedAt}`;
  const runRoot = runDirectory(options.projectRoot, id);
  await mkdir(resolve(runRoot, "traces"), { recursive: true });
  const incrementalPlan = options.incremental
    ? planIncrementalExploration(
        options.incremental.priorRun,
        options,
        options.incremental.changes,
        options.incremental.forceFull,
      )
    : undefined;
  const reusedIds = new Set(
    incrementalPlan?.mode === "incremental"
      ? incrementalPlan.reusedStateIds
      : [],
  );
  const reusedStates = options.incremental
    ? options.incremental.priorRun.states
        .filter((state) => reusedIds.has(state.id))
        .map((state) => ({
          ...state,
          provenance: {
            kind: "reused" as const,
            sourceRunId: options.incremental!.priorRun.id,
          },
        }))
    : [];
  if (options.incremental && reusedStates.length > 0)
    await copyReusedEvidence(
      options.incremental.priorRun,
      runRoot,
      reusedStates,
    );
  const states: StateNode[] = [...reusedStates];
  const transitions: Transition[] = options.incremental
    ? options.incremental.priorRun.transitions.filter(
        (transition) =>
          reusedIds.has(transition.source) && reusedIds.has(transition.target),
      )
    : [];
  const warnings: string[] = [];
  const extensionRuntime = await prepareExtensionRuntime(
    options.extensionModules ?? [],
    options.allowExtensions ?? false,
  );
  warnings.push(...extensionRuntime.warnings);
  const browser = await browserFor(options.browser).launch({
    headless: options.headless,
  });
  if (options.evidenceMode !== "metadata")
    warnings.push(
      "Screenshot or trace evidence is enabled and may contain sensitive visual application data despite text redaction.",
    );
  const initialPaths =
    incrementalPlan?.mode === "incremental"
      ? incrementalPlan.seedPaths
      : ([[]] as ReplayStep[][]);
  const queue: QueueItem[] = initialPaths.map((path) => ({
    path,
    ...(path.at(-1)?.sourceStateId && reusedIds.has(path.at(-1)!.sourceStateId!)
      ? {
          parentStateId: path.at(-1)!.sourceStateId,
          action: path.at(-1)!.action,
        }
      : {}),
  }));
  const queuedPaths = new Set(
    initialPaths.map(
      (path) => path.map((step) => step.action.id).join("/") || "root",
    ),
  );
  const discovered = new Map<string, StateNode>(
    reusedStates.map((state) => [state.fingerprint, state]),
  );
  const transitionIds = new Set(transitions.map((transition) => transition.id));
  const adapterWarnings = new Set<string>();
  let errorCount = 0;
  let repeatedActionsSkipped = 0;
  let observedStates = 0;

  report(onProgress, "starting", `Mapping ${options.baseUrl}`, 0, 0);

  try {
    await executeCommandHook(
      options.allowHooks ? options.seedHook : undefined,
      "Seed",
    );
    while (queue.length > 0 && observedStates < options.maxStates) {
      const item = queue.shift();
      if (!item) break;
      const contextSetup = await createContext(browser, options);
      const context = contextSetup.context;
      const page = await context.newPage();
      const signals = attachSignals(page, contextSetup.blockedRequests);
      if (options.evidenceMode === "full")
        await context.tracing.start({ screenshots: false, snapshots: true });
      let traceStopped = false;

      try {
        await executeCommandHook(
          options.allowHooks ? options.resetHook : undefined,
          "Reset",
        );
        await page.goto(options.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: options.navigationTimeoutMs,
        });
        await waitForStableState(page, options);
        for (const step of item.path) {
          await executeStep(page, step, options.actionTimeoutMs);
          await waitForStableState(page, options);
        }
        if (!originAllowed(page.url(), options.allowedOrigins)) {
          throw new Error(`Navigation to disallowed origin: ${page.url()}`);
        }

        const capture = await captureState(
          page,
          options,
          item.path,
          signals,
          adapterWarnings,
          extensionRuntime,
        );
        const captured = capture.state;
        const existing = discovered.get(captured.fingerprint);
        const target = existing ?? captured;

        if (item.parentStateId && item.action) {
          const transition = transitionFor(
            item.parentStateId,
            target.id,
            item.action,
          );
          if (!transitionIds.has(transition.id)) {
            transitions.push(transition);
            transitionIds.add(transition.id);
            report(
              onProgress,
              "transition",
              `${item.action.label} → ${target.heading || target.title || target.url}`,
              states.length,
              transitions.length,
            );
          }
        }

        if (existing) {
          if (options.evidenceMode === "full") await context.tracing.stop();
          traceStopped = true;
          continue;
        }

        await persistStateEvidence(page, runRoot, captured);
        if (options.evidenceMode === "full" && captured.evidence.tracePath) {
          await context.tracing.stop({
            path: resolve(runRoot, captured.evidence.tracePath),
          });
        }
        traceStopped = true;
        discovered.set(captured.fingerprint, captured);
        states.push(captured);
        observedStates += 1;
        report(
          onProgress,
          "state",
          `Discovered ${captured.heading || captured.title || captured.url}`,
          states.length,
          transitions.length,
        );

        if (captured.depth >= options.maxDepth) continue;
        const candidates = capture.candidates.map((action) => ({ action }));
        for (const candidate of candidates) {
          const action = candidate.action;
          const blocked = !actionAllowed(action, options.explorationMode)
            .allowed;
          const external =
            action.href && !originAllowed(action.href, options.allowedOrigins);
          const repeatedInPath = item.path.some(
            (step) => step.action.id === action.id,
          );
          if (blocked || external) continue;
          if (repeatedInPath) {
            repeatedActionsSkipped += 1;
            continue;
          }

          const nextPath = [
            ...item.path,
            { action, sourceStateId: captured.id },
          ];
          const pathKey = nextPath.map((step) => step.action.id).join("/");
          if (queuedPaths.has(pathKey)) {
            repeatedActionsSkipped += 1;
            continue;
          }
          queuedPaths.add(pathKey);
          queue.push({
            path: nextPath,
            parentStateId: captured.id,
            action,
          });
        }
      } catch (error) {
        errorCount += 1;
        const message = `Could not explore path ${
          item.path.map((step) => step.action.label).join(" → ") || "root"
        }: ${errorMessage(error)}`;
        warnings.push(message);
        report(
          onProgress,
          "warning",
          message,
          states.length,
          transitions.length,
        );
      } finally {
        if (!traceStopped) {
          if (options.evidenceMode === "full")
            await context.tracing.stop().catch(() => undefined);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const completedAt = new Date().toISOString();
  warnings.push(...[...adapterWarnings].sort());
  for (const warning of extensionRuntime.warnings)
    if (!warnings.includes(warning)) warnings.push(warning);
  const commit = options.commit ?? (await detectCommit(options.projectRoot));
  const blockedActions = states.reduce(
    (count, state) => count + state.blockedActions.length,
    0,
  );
  if (queue.length > 0 && states.length > 0) {
    const lastState = states.at(-1)!;
    lastState.coverageStatus = "budget_limited";
    lastState.coverageReason =
      "Exploration stopped with queued paths remaining at the configured state budget.";
  }
  const run: BehaviorRun = {
    schemaVersion: STATESCRY_SCHEMA_VERSION,
    id,
    name,
    projectName: basename(options.projectRoot),
    projectRoot: options.projectRoot,
    baseUrl: redactUrl(options.baseUrl),
    startedAt,
    completedAt,
    ...(commit ? { commit } : {}),
    environment: options.environment,
    persona: options.persona,
    viewport: options.viewport,
    featureContext: redactRecord(options.featureContext),
    options: {
      browser: options.browser,
      maxStates: options.maxStates,
      maxDepth: options.maxDepth,
      allowedOrigins: options.allowedOrigins,
      maxActionsPerState: options.maxActionsPerState,
      explorationMode: options.explorationMode,
      mutationAllowlist: options.mutationAllowlist.map((rule) => ({
        ...rule,
        urlPattern: redactText(rule.urlPattern),
        ...(rule.reason ? { reason: redactText(rule.reason) } : {}),
      })),
      evidenceMode: options.evidenceMode,
      ignoredTextPatterns: options.ignoredTextPatterns,
      frameworkAdapters: options.frameworkAdapters ?? [],
      extensionsEnabled: options.allowExtensions ?? false,
      extensions: extensionRuntime.inspections.map(
        (inspection) =>
          `${inspection.manifest.name}@${inspection.manifest.version}`,
      ),
    },
    states,
    transitions,
    warnings,
    stats: {
      states: states.length,
      transitions: transitions.length,
      blockedActions,
      durationMs: Date.now() - started,
      truncated: queue.length > 0,
      errors: errorCount,
      coverage: {
        queuedPaths: queuedPaths.size,
        exploredPaths: states.length,
        policyBlockedActions: blockedActions,
        repeatedActionsSkipped,
        depthLimitedStates: states.filter(
          (state) => state.depth >= options.maxDepth,
        ).length,
        budgetLimited: queue.length > 0,
        executionFailures: errorCount,
        statement:
          queue.length > 0
            ? "Exploration stopped at the configured budget; this is not complete coverage."
            : "Coverage is limited to discovered safe paths and configured actions.",
      },
      observedStates,
      reusedStates: reusedStates.length,
    },
    ...(incrementalPlan
      ? {
          incremental: {
            mode: incrementalPlan.mode,
            priorRunId: options.incremental!.priorRun.id,
            declaredChanges: options.incremental!.changes,
            invalidationReasons: incrementalPlan.invalidationReasons,
            invalidatedStateIds: incrementalPlan.invalidatedStateIds,
            reusedStateIds: incrementalPlan.reusedStateIds,
            exploredSeedPaths: incrementalPlan.seedPaths.length,
            forcedFull: incrementalPlan.forcedFull,
          },
        }
      : {}),
  };
  await saveRun(run);
  report(
    onProgress,
    "complete",
    `Saved ${states.length} states and ${transitions.length} transitions as ${id}`,
    states.length,
    transitions.length,
  );
  return run;
}
