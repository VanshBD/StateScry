import {
  exploreApplication,
  loadRun,
  resolveExploreOptions,
  type BrowserName,
  type BehaviorRun,
  type EvidenceMode,
  type ExplorationMode,
  type IncrementalChangeSet,
} from "@statescry-tool/core";
import type { Command } from "commander";

export interface GlobalOptions {
  root: string;
  json: boolean;
}

export function output(value: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  console.table(value);
}

export function globalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

export function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function collectCsv(value: string, previous: string[] = []): string[] {
  return [...previous, ...parseCsv(value)];
}

export function parseFeature(value: string, previous: Record<string, string>) {
  const separator = value.indexOf("=");
  if (separator < 1) {
    throw new Error(`Feature context must use key=value, received “${value}”.`);
  }
  return {
    ...previous,
    [value.slice(0, separator)]: value.slice(separator + 1),
  };
}

export async function mapOnce(
  url: string,
  commandOptions: Record<string, unknown>,
  globals: GlobalOptions,
): Promise<BehaviorRun> {
  const options = await resolveExploreOptions({
    baseUrl: url,
    projectRoot: globals.root,
    ...(typeof commandOptions.name === "string"
      ? { name: commandOptions.name }
      : {}),
    ...(typeof commandOptions.browser === "string"
      ? { browser: commandOptions.browser as BrowserName }
      : {}),
    ...(typeof commandOptions.headless === "boolean"
      ? { headless: commandOptions.headless }
      : {}),
    ...(typeof commandOptions.maxStates === "number"
      ? { maxStates: commandOptions.maxStates }
      : {}),
    ...(typeof commandOptions.maxDepth === "number"
      ? { maxDepth: commandOptions.maxDepth }
      : {}),
    ...(typeof commandOptions.persona === "string"
      ? { persona: commandOptions.persona }
      : {}),
    ...(typeof commandOptions.role === "string"
      ? { role: commandOptions.role }
      : {}),
    ...(typeof commandOptions.storageState === "string"
      ? { storageStatePath: commandOptions.storageState }
      : {}),
    ...(typeof commandOptions.viewport === "string"
      ? { viewport: commandOptions.viewport }
      : {}),
    ...(typeof commandOptions.width === "number"
      ? { width: commandOptions.width }
      : {}),
    ...(typeof commandOptions.height === "number"
      ? { height: commandOptions.height }
      : {}),
    ...(typeof commandOptions.environment === "string"
      ? { environment: commandOptions.environment }
      : {}),
    ...(typeof commandOptions.evidence === "string"
      ? { evidenceMode: commandOptions.evidence as EvidenceMode }
      : {}),
    ...(typeof commandOptions.explorationMode === "string"
      ? { explorationMode: commandOptions.explorationMode as ExplorationMode }
      : {}),
    ...(commandOptions.allowHooks === true ? { allowHooks: true } : {}),
    ...(commandOptions.allowExtensions === true
      ? { allowExtensions: true }
      : {}),
    ...(commandOptions.feature &&
    typeof commandOptions.feature === "object" &&
    !Array.isArray(commandOptions.feature)
      ? { featureContext: commandOptions.feature as Record<string, string> }
      : {}),
  });
  if (typeof commandOptions.incrementalFrom === "string") {
    const changes: IncrementalChangeSet = {
      ...(Array.isArray(commandOptions.changedRoute)
        ? { routes: commandOptions.changedRoute as string[] }
        : {}),
      ...(Array.isArray(commandOptions.changedSelector)
        ? { selectors: commandOptions.changedSelector as string[] }
        : {}),
      ...(Array.isArray(commandOptions.changedFile)
        ? { files: commandOptions.changedFile as string[] }
        : {}),
      ...(typeof commandOptions.changeReason === "string"
        ? { reason: commandOptions.changeReason }
        : {}),
    };
    options.incremental = {
      priorRun: await loadRun(globals.root, commandOptions.incrementalFrom),
      changes,
      ...(commandOptions.forceFull === true ? { forceFull: true } : {}),
    };
  } else if (commandOptions.forceFull === true) {
    throw new Error("--force-full requires --incremental-from.");
  }
  return exploreApplication(
    options,
    globals.json
      ? undefined
      : (progress) => {
          process.stderr.write(
            `[${progress.states} states · ${progress.transitions} edges] ${progress.message}\n`,
          );
        },
  );
}
