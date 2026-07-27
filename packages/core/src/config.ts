import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, resolve } from "node:path";

import type {
  BrowserName,
  EvidenceMode,
  ExplorationMode,
  ExploreOptions,
  MutationAllowRule,
  Persona,
  Viewport,
} from "./types.js";
import { StateScryError } from "./errors.js";
import { validateFrameworkAdapters } from "./adapters.js";

export interface StateScryConfig {
  browser?: BrowserName;
  headless?: boolean;
  maxStates?: number;
  maxDepth?: number;
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  allowedOrigins?: string[];
  explorationMode?: ExplorationMode;
  mutationAllowlist?: MutationAllowRule[];
  evidenceMode?: EvidenceMode;
  maxActionsPerState?: number;
  settleMs?: number;
  redactPatterns?: string[];
  ignoredTextPatterns?: string[];
  inputs?: ExploreOptions["inputs"];
  customActions?: ExploreOptions["customActions"];
  waitForSelectors?: string[];
  replayAssertions?: ExploreOptions["replayAssertions"];
  resetHook?: ExploreOptions["resetHook"];
  seedHook?: ExploreOptions["seedHook"];
  environment?: string;
  featureContext?: Record<string, string>;
  personas?: Record<string, { role?: string; storageStatePath?: string }>;
  viewports?: Record<string, { width: number; height: number }>;
  frameworkAdapters?: ExploreOptions["frameworkAdapters"];
  extensions?: string[];
}

const DEFAULT_VIEWPORTS: Record<string, Viewport> = {
  desktop: { name: "desktop", width: 1440, height: 900 },
  tablet: { name: "tablet", width: 768, height: 1024 },
  mobile: { name: "mobile", width: 390, height: 844 },
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(
  projectRoot: string,
): Promise<StateScryConfig> {
  const path = resolve(projectRoot, "statescry.config.json");
  if (!(await pathExists(path))) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new StateScryError(
      "INVALID_CONFIG",
      "statescry.config.json contains invalid JSON: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  return validateConfig(parsed);
}

export function validateConfig(value: unknown): StateScryConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StateScryError(
      "INVALID_CONFIG",
      "statescry.config.json must contain an object.",
    );
  const config = value as Record<string, unknown>;
  const numberKeys = [
    "maxStates",
    "maxDepth",
    "maxActionsPerState",
    "actionTimeoutMs",
    "navigationTimeoutMs",
    "settleMs",
  ];
  for (const key of numberKeys)
    if (
      config[key] !== undefined &&
      (typeof config[key] !== "number" ||
        !Number.isFinite(config[key]) ||
        (config[key] as number) <= 0)
    )
      throw new StateScryError(
        "INVALID_CONFIG",
        key + " must be a positive number.",
      );
  if (
    config.browser !== undefined &&
    !["chromium", "firefox", "webkit"].includes(String(config.browser))
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "browser must be chromium, firefox, or webkit.",
    );
  if (config.headless !== undefined && typeof config.headless !== "boolean")
    throw new StateScryError("INVALID_CONFIG", "headless must be a boolean.");
  if (
    config.explorationMode !== undefined &&
    !["observe", "allowlist"].includes(String(config.explorationMode))
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "explorationMode must be observe or allowlist.",
    );
  if (
    config.evidenceMode !== undefined &&
    !["metadata", "screenshots", "full"].includes(String(config.evidenceMode))
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "evidenceMode must be metadata, screenshots, or full.",
    );
  for (const key of [
    "allowedOrigins",
    "redactPatterns",
    "ignoredTextPatterns",
    "waitForSelectors",
    "extensions",
  ])
    if (
      config[key] !== undefined &&
      (!Array.isArray(config[key]) ||
        config[key].some((item) => typeof item !== "string"))
    )
      throw new StateScryError(
        "INVALID_CONFIG",
        key + " must be an array of strings.",
      );
  if (Array.isArray(config.redactPatterns))
    for (const pattern of config.redactPatterns)
      try {
        new RegExp(pattern);
      } catch {
        throw new StateScryError(
          "INVALID_CONFIG",
          `redactPatterns contains an invalid regular expression: ${pattern}`,
        );
      }
  if (Array.isArray(config.allowedOrigins))
    for (const origin of config.allowedOrigins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new StateScryError(
          "INVALID_CONFIG",
          `allowedOrigins contains an invalid URL: ${origin}`,
        );
      }
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.origin !== origin
      )
        throw new StateScryError(
          "INVALID_CONFIG",
          `allowedOrigins entries must be exact HTTP(S) origins: ${origin}`,
        );
    }
  if (
    config.mutationAllowlist !== undefined &&
    (!Array.isArray(config.mutationAllowlist) ||
      config.mutationAllowlist.some(
        (rule) =>
          !rule ||
          typeof rule !== "object" ||
          typeof (rule as Record<string, unknown>).method !== "string" ||
          !["POST", "PUT", "PATCH", "DELETE"].includes(
            String((rule as Record<string, unknown>).method).toUpperCase(),
          ) ||
          typeof (rule as Record<string, unknown>).urlPattern !== "string" ||
          !(rule as Record<string, unknown>).urlPattern,
      ))
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "mutationAllowlist entries require a POST/PUT/PATCH/DELETE method and non-empty urlPattern.",
    );
  if (
    config.explorationMode === "allowlist" &&
    (!Array.isArray(config.mutationAllowlist) ||
      config.mutationAllowlist.length === 0)
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "allowlist mode requires mutationAllowlist entries.",
    );
  for (const key of ["inputs", "customActions", "replayAssertions"]) {
    if (config[key] !== undefined && !Array.isArray(config[key]))
      throw new StateScryError("INVALID_CONFIG", key + " must be an array.");
  }
  if (
    Array.isArray(config.inputs) &&
    config.inputs.some(
      (input) =>
        !input ||
        typeof input !== "object" ||
        typeof (input as Record<string, unknown>).selector !== "string" ||
        typeof (input as Record<string, unknown>).value !== "string",
    )
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "inputs entries require selector and value strings.",
    );
  if (
    Array.isArray(config.customActions) &&
    config.customActions.some((action) => {
      const value = action as Record<string, unknown>;
      return (
        !action ||
        typeof action !== "object" ||
        typeof value.name !== "string" ||
        !["click", "fill", "press", "select", "check"].includes(
          String(value.kind),
        ) ||
        (value.kind === "press"
          ? typeof value.key !== "string"
          : typeof value.selector !== "string")
      );
    })
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "customActions entries require name, a supported kind, and selector (or key for press).",
    );
  for (const key of ["resetHook", "seedHook"]) {
    const hook = config[key] as Record<string, unknown> | undefined;
    if (
      hook !== undefined &&
      (!hook ||
        typeof hook !== "object" ||
        typeof hook.command !== "string" ||
        (hook.args !== undefined &&
          (!Array.isArray(hook.args) ||
            hook.args.some((arg) => typeof arg !== "string"))) ||
        (hook.timeoutMs !== undefined &&
          (typeof hook.timeoutMs !== "number" || hook.timeoutMs <= 0)))
    )
      throw new StateScryError(
        "INVALID_CONFIG",
        key + " requires a command string and optional args string array.",
      );
  }
  if (config.personas !== undefined) {
    if (
      !config.personas ||
      typeof config.personas !== "object" ||
      Array.isArray(config.personas)
    )
      throw new StateScryError(
        "INVALID_CONFIG",
        "personas must be an object keyed by persona name.",
      );
    for (const [name, persona] of Object.entries(
      config.personas as Record<string, unknown>,
    )) {
      const entry = persona as Record<string, unknown>;
      if (
        !persona ||
        typeof persona !== "object" ||
        Array.isArray(persona) ||
        (entry.role !== undefined && typeof entry.role !== "string") ||
        (entry.storageStatePath !== undefined &&
          typeof entry.storageStatePath !== "string")
      )
        throw new StateScryError(
          "INVALID_CONFIG",
          `personas.${name} must contain optional role and storageStatePath strings.`,
        );
    }
  }
  if (config.viewports !== undefined) {
    if (
      !config.viewports ||
      typeof config.viewports !== "object" ||
      Array.isArray(config.viewports)
    )
      throw new StateScryError(
        "INVALID_CONFIG",
        "viewports must be an object keyed by viewport name.",
      );
    for (const [name, viewport] of Object.entries(
      config.viewports as Record<string, unknown>,
    )) {
      const entry = viewport as Record<string, unknown>;
      if (
        !viewport ||
        typeof viewport !== "object" ||
        typeof entry.width !== "number" ||
        entry.width <= 0 ||
        typeof entry.height !== "number" ||
        entry.height <= 0
      )
        throw new StateScryError(
          "INVALID_CONFIG",
          `viewports.${name} requires positive width and height numbers.`,
        );
    }
  }
  if (
    config.featureContext !== undefined &&
    (!config.featureContext ||
      typeof config.featureContext !== "object" ||
      Array.isArray(config.featureContext) ||
      Object.values(config.featureContext as Record<string, unknown>).some(
        (entry) => typeof entry !== "string",
      ))
  )
    throw new StateScryError(
      "INVALID_CONFIG",
      "featureContext must be an object of string values.",
    );
  if (Array.isArray(config.replayAssertions))
    for (const assertion of config.replayAssertions) {
      const entry = assertion as Record<string, unknown>;
      if (
        !assertion ||
        typeof assertion !== "object" ||
        !["url", "title", "heading", "text", "selector"].includes(
          String(entry.type),
        ) ||
        typeof entry.expected !== "string" ||
        (entry.type === "selector" && typeof entry.selector !== "string")
      )
        throw new StateScryError(
          "INVALID_CONFIG",
          "replayAssertions entries require a supported type, expected string, and selector for selector assertions.",
        );
    }
  if (config.frameworkAdapters !== undefined) {
    if (!Array.isArray(config.frameworkAdapters))
      throw new StateScryError(
        "INVALID_CONFIG",
        "frameworkAdapters must be an array.",
      );
    try {
      validateFrameworkAdapters(
        config.frameworkAdapters as NonNullable<
          StateScryConfig["frameworkAdapters"]
        >,
      );
    } catch (error) {
      throw new StateScryError(
        "INVALID_CONFIG",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return config as StateScryConfig;
}

interface ResolveOptionsInput {
  baseUrl: string;
  projectRoot?: string;
  name?: string;
  browser?: BrowserName;
  headless?: boolean;
  maxStates?: number;
  maxDepth?: number;
  allowedOrigins?: string[];
  explorationMode?: ExplorationMode;
  mutationAllowlist?: MutationAllowRule[];
  evidenceMode?: EvidenceMode;
  maxActionsPerState?: number;
  allowHooks?: boolean;
  environment?: string;
  persona?: string;
  role?: string;
  storageStatePath?: string;
  viewport?: string;
  width?: number;
  height?: number;
  commit?: string;
  featureContext?: Record<string, string>;
  allowExtensions?: boolean;
}

export async function resolveExploreOptions(
  input: ResolveOptionsInput,
): Promise<ExploreOptions> {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const config = await loadConfig(projectRoot);
  const baseOrigin = new URL(input.baseUrl).origin;
  const personaName = input.persona ?? "default";
  const configuredPersona = config.personas?.[personaName];
  const persona: Persona = {
    name: personaName,
    role: input.role ?? configuredPersona?.role ?? "anonymous",
    ...((input.storageStatePath ?? configuredPersona?.storageStatePath)
      ? {
          storageStatePath: resolve(
            projectRoot,
            (input.storageStatePath ??
              configuredPersona?.storageStatePath) as string,
          ),
        }
      : {}),
  };

  const viewportName = input.viewport ?? "desktop";
  const configuredViewport =
    config.viewports?.[viewportName] ?? DEFAULT_VIEWPORTS[viewportName];
  const viewport: Viewport = {
    name: viewportName,
    width: input.width ?? configuredViewport?.width ?? 1440,
    height: input.height ?? configuredViewport?.height ?? 900,
  };
  const extraOrigins =
    input.allowedOrigins ??
    config.allowedOrigins ??
    process.env.STATESCRY_ALLOWED_ORIGINS?.split(",").filter(Boolean) ??
    [];

  return {
    baseUrl: input.baseUrl,
    projectRoot,
    ...(input.name ? { name: input.name } : {}),
    browser:
      input.browser ??
      config.browser ??
      (process.env.STATESCRY_BROWSER as BrowserName | undefined) ??
      "chromium",
    headless:
      input.headless ??
      config.headless ??
      process.env.STATESCRY_HEADLESS !== "false",
    maxStates:
      input.maxStates ??
      config.maxStates ??
      Number(process.env.STATESCRY_MAX_STATES ?? 100),
    maxDepth:
      input.maxDepth ??
      config.maxDepth ??
      Number(process.env.STATESCRY_MAX_DEPTH ?? 8),
    actionTimeoutMs: config.actionTimeoutMs ?? 5_000,
    navigationTimeoutMs: config.navigationTimeoutMs ?? 15_000,
    allowedOrigins: [...new Set([baseOrigin, ...extraOrigins])],
    maxActionsPerState:
      input.maxActionsPerState ?? config.maxActionsPerState ?? 60,
    settleMs: config.settleMs ?? 150,
    explorationMode:
      input.explorationMode ?? config.explorationMode ?? "observe",
    mutationAllowlist:
      input.mutationAllowlist ?? config.mutationAllowlist ?? [],
    evidenceMode: input.evidenceMode ?? config.evidenceMode ?? "metadata",
    allowHooks: input.allowHooks ?? false,
    redactPatterns: config.redactPatterns ?? [],
    ignoredTextPatterns: config.ignoredTextPatterns ?? [],
    inputs: config.inputs ?? [],
    customActions: config.customActions ?? [],
    waitForSelectors: config.waitForSelectors ?? [],
    replayAssertions: config.replayAssertions ?? [],
    ...(input.allowHooks && config.resetHook
      ? { resetHook: config.resetHook }
      : {}),
    ...(input.allowHooks && config.seedHook
      ? { seedHook: config.seedHook }
      : {}),
    persona,
    viewport,
    featureContext: {
      ...config.featureContext,
      ...input.featureContext,
    },
    ...(input.commit ? { commit: input.commit } : {}),
    environment: input.environment ?? config.environment ?? "local",
    frameworkAdapters: config.frameworkAdapters ?? [],
    extensionModules: (config.extensions ?? []).map((path) =>
      resolve(projectRoot, path),
    ),
    allowExtensions: input.allowExtensions ?? false,
  };
}

export function projectNameFromRoot(projectRoot: string): string {
  return basename(projectRoot);
}
