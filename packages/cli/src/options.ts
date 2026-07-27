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

export function printBanner(jsonMode: boolean): void {
  if (jsonMode || !process.stdout.isTTY) return;
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const bold = "\x1b[1m";
  const dim = "\x1b[90m";
  const reset = "\x1b[0m";

  process.stdout.write(
    `\n${cyan}┌─────────────────────────────────────────────────────────────┐${reset}\n` +
      `${cyan}│${reset}  ${bold}${green}🔮 StateScry v2.0.3${reset} ${dim}— Behavioral Memory Engine for Web Apps${reset}   ${cyan}│${reset}\n` +
      `${cyan}└─────────────────────────────────────────────────────────────┘${reset}\n\n`,
  );
}

export function createSpinner(text: string, jsonMode = false) {
  if (jsonMode || !process.stdout.isTTY) {
    if (!jsonMode) process.stdout.write(`[statescry] ${text}\n`);
    return {
      update(nextText: string) {
        if (!jsonMode) process.stdout.write(`[statescry] ${nextText}\n`);
      },
      stop(finalText?: string) {
        if (!jsonMode && finalText)
          process.stdout.write(`[statescry] ${finalText}\n`);
      },
    };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let currentText = text;
  process.stdout.write(`\x1b[?25l\x1b[36m${frames[0]}\x1b[0m ${currentText}`);
  const timer = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r\x1b[K\x1b[36m${frames[i]}\x1b[0m ${currentText}`);
  }, 80);

  return {
    update(nextText: string) {
      currentText = nextText;
      process.stdout.write(
        `\r\x1b[K\x1b[36m${frames[i]}\x1b[0m ${currentText}`,
      );
    },
    stop(finalText?: string) {
      clearInterval(timer);
      process.stdout.write(`\r\x1b[K\x1b[?25h`);
      if (finalText) {
        process.stdout.write(`\x1b[32m✔\x1b[0m ${finalText}\n`);
      }
    },
  };
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
  printBanner(globals.json);
  const spinner = createSpinner(
    `Exploring ${url} using Playwright…`,
    globals.json,
  );
  try {
    const run = await exploreApplication(
      options,
      globals.json
        ? undefined
        : (progress) => {
            spinner.update(
              `[${progress.states} states · ${progress.transitions} transitions] ${progress.message}`,
            );
          },
    );
    spinner.stop(
      `Mapping complete! Discovered ${run.states.length} states & ${run.transitions.length} transitions (${run.id}).`,
    );
    return run;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}
