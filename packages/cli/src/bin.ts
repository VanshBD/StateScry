#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  analyzeRun,
  calculateCoverageHistory,
  compareRoleAccess,
  compareRuns,
  errorMessage,
  evaluateBenchmark,
  loadConfig,
  listRuns,
  loadRun,
  replayState,
  resolveExploreOptions,
  runMappingMatrix,
  shortestPath,
  startDashboardServer,
  type BenchmarkManifest,
  type ReplayResult,
} from "@statescry-tool/core";
import { Command, Option } from "commander";
import {
  inspectExtension,
  invokeExtension,
  type ExtensionCapability,
} from "@statescry-tool/sdk";

import {
  globalOptions,
  collectCsv,
  mapOnce,
  output,
  parseCsv,
  parseFeature,
  printBanner,
} from "./options.js";
import { initializeProject } from "./init.js";
import { importPlaywrightJourneys } from "./playwright-import.js";
import {
  behaviorReportAnnotations,
  behaviorReportMarkdown,
  createBehaviorReport,
} from "./report.js";

const program = new Command();

program
  .name("statescry")
  .description("Map, replay, and compare the behavior of web applications.")
  .version("2.0.0")
  .option("--root <path>", "project root containing .statescry", process.cwd())
  .option("--json", "emit machine-readable JSON", false);

program
  .command("init")
  .description("Create a safe project configuration with detected defaults.")
  .argument("[url]", "local application URL")
  .option("--force", "explicitly replace an existing configuration")
  .action(async (url, options, command) => {
    const globals = globalOptions(command);
    const result = await initializeProject(
      globals.root,
      typeof url === "string" ? url : undefined,
      options.force === true,
    );
    output(
      globals.json
        ? result
        : [
            {
              framework: result.framework,
              config: result.configPath,
              url: result.baseUrl,
              playwright: result.playwrightConfigured
                ? "detected"
                : "not detected",
            },
            ...result.nextCommands.map((next) => ({ next })),
          ],
      globals.json,
    );
  });

program
  .command("import-playwright")
  .description(
    "Import supported Playwright journeys without executing test code.",
  )
  .argument("<paths...>", "test files or directories")
  .option(
    "--output <path>",
    "versioned journey artifact",
    ".statescry/imports/playwright-journeys.json",
  )
  .option("--strict", "exit 2 when any import diagnostic is produced")
  .action(async (paths, options, command) => {
    const globals = globalOptions(command);
    const artifact = await importPlaywrightJourneys(
      globals.root,
      paths,
      options.output,
    );
    output(globals.json ? artifact : [artifact.summary], globals.json);
    if (
      artifact.summary.errors > 0 ||
      (options.strict && artifact.diagnostics.length > 0)
    )
      process.exitCode = 2;
  });

program
  .command("map")
  .description("Explore a web application and persist a behavior run.")
  .argument("<url>", "application URL")
  .option("--name <name>", "friendly run name")
  .addOption(
    new Option("--browser <browser>", "browser engine")
      .choices(["chromium", "firefox", "webkit"])
      .default("chromium"),
  )
  .option("--headed", "show the browser while exploring")
  .option("--max-states <count>", "state budget", Number)
  .option("--max-depth <count>", "action depth budget", Number)
  .option("--persona <name>", "configured persona name", "default")
  .option("--role <role>", "role recorded for this run")
  .option("--storage-state <path>", "Playwright storage-state JSON")
  .option("--viewport <name>", "configured viewport name", "desktop")
  .option("--width <pixels>", "custom viewport width", Number)
  .option("--height <pixels>", "custom viewport height", Number)
  .option("--environment <name>", "environment label", "local")
  .option(
    "--feature <key=value>",
    "feature context; repeatable",
    parseFeature,
    {},
  )
  .option("--evidence <mode>", "metadata, screenshots, or full")
  .option("--exploration-mode <mode>", "observe or allowlist")
  .option("--allow-hooks", "allow configured local reset and seed hooks")
  .option(
    "--allow-extensions",
    "load explicitly configured reviewed extensions",
  )
  .option(
    "--incremental-from <run>",
    "reuse unaffected states from a prior run",
  )
  .option(
    "--changed-route <routes>",
    "declared changed route; comma-separated or repeatable",
    collectCsv,
    [],
  )
  .option(
    "--changed-selector <selectors>",
    "declared changed selector; comma-separated or repeatable",
    collectCsv,
    [],
  )
  .option(
    "--changed-file <files>",
    "declared changed file; comma-separated or repeatable",
    collectCsv,
    [],
  )
  .option("--change-reason <reason>", "human-readable change-set reason")
  .option("--force-full", "force a full map while recording invalidation")
  .action(async (url, commandOptions, command) => {
    const globals = globalOptions(command);
    const run = await mapOnce(
      url,
      { ...commandOptions, headless: !commandOptions.headed },
      globals,
    );
    output(
      globals.json
        ? run
        : [
            {
              id: run.id,
              name: run.name,
              states: run.states.length,
              transitions: run.transitions.length,
              blocked: run.stats.blockedActions,
              truncated: run.stats.truncated,
              mode: run.incremental?.mode ?? "full",
              observed: run.stats.observedStates ?? run.states.length,
              reused: run.stats.reusedStates ?? 0,
            },
          ],
      globals.json,
    );
  });

program
  .command("benchmark")
  .description(
    "Score a behavior run against an independently reviewed manifest.",
  )
  .argument("<run>", "candidate run ID or name")
  .requiredOption("--manifest <path>", "versioned benchmark manifest JSON")
  .option("--before <run>", "baseline run for planted behavior changes")
  .option("--replay-results <path>", "JSON array of replay results")
  .option(
    "--completed-unapproved-mutations <count>",
    "observed prohibited mutations that completed",
    Number,
  )
  .option(
    "--detected-secret-leaks <count>",
    "planted secrets found in persisted evidence",
    Number,
  )
  .option("--output <path>", "write deterministic JSON or Markdown")
  .option("--format <format>", "json or markdown", "markdown")
  .option(
    "--no-fail-on-threshold",
    "report threshold failures without returning exit code 2",
  )
  .action(async (runId, options, command) => {
    const globals = globalOptions(command);
    const manifestPath = resolve(globals.root, options.manifest);
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as BenchmarkManifest;
    const candidate = await loadRun(globals.root, runId);
    const before = options.before
      ? await loadRun(globals.root, options.before)
      : undefined;
    const replayResults = options.replayResults
      ? (JSON.parse(
          await readFile(resolve(globals.root, options.replayResults), "utf8"),
        ) as ReplayResult[])
      : undefined;
    const result = evaluateBenchmark(manifest, {
      run: candidate,
      ...(before ? { beforeRun: before } : {}),
      ...(replayResults ? { replayResults } : {}),
      ...(typeof options.completedUnapprovedMutations === "number"
        ? {
            completedUnapprovedMutations: options.completedUnapprovedMutations,
          }
        : {}),
      ...(typeof options.detectedSecretLeaks === "number"
        ? { detectedSecretLeaks: options.detectedSecretLeaks }
        : {}),
    });
    if (options.format !== "json" && options.format !== "markdown")
      throw new Error("--format must be json or markdown.");
    const markdown =
      [
        `# StateScry benchmark: ${result.manifest}`,
        "",
        `**Overall:** ${(result.score * 100).toFixed(2)}% (${result.passed ? "passed" : "failed"})`,
        "",
        "| Metric | Score | Threshold | Result |",
        "| --- | ---: | ---: | --- |",
        ...Object.entries(result.metrics).map(
          ([name, value]) =>
            `| ${name} | ${(value.score * 100).toFixed(2)}% | ${(value.threshold * 100).toFixed(2)}% | ${value.passed ? "pass" : "fail"} |`,
        ),
        "",
        "## Failures",
        ...(result.failures.length
          ? result.failures.map((failure) => `- ${failure}`)
          : ["- None"]),
        "",
        "## Interpretation limits",
        ...result.limitations.map((limitation) => `- ${limitation}`),
      ].join("\n") + "\n";
    if (options.output)
      await writeFile(
        resolve(globals.root, options.output),
        options.format === "json"
          ? `${JSON.stringify(result, null, 2)}\n`
          : markdown,
        "utf8",
      );
    output(globals.json ? result : Object.values(result.metrics), globals.json);
    if (!result.passed && options.failOnThreshold !== false)
      process.exitCode = 2;
  });

program
  .command("report")
  .description("Write a PR-friendly JSON or Markdown behavior-diff report.")
  .argument("<before>", "baseline run ID or name")
  .argument("<after>", "candidate run ID or name")
  .requiredOption("--output <path>", "report file path")
  .option("--format <format>", "json or markdown", "markdown")
  .option("--fail-on-change", "exit 2 when the report contains changes")
  .option("--replay-results <path>", "JSON array of verified replay results")
  .option("--github-summary", "append Markdown to GITHUB_STEP_SUMMARY")
  .option("--github-annotations", "emit GitHub workflow warning annotations")
  .option(
    "--fail-on-low-confidence <score>",
    "exit 2 when minimum match confidence is below 0..1",
    Number,
  )
  .action(async (beforeId, afterId, options, command) => {
    const globals = globalOptions(command);
    const [before, after] = await Promise.all([
      loadRun(globals.root, beforeId),
      loadRun(globals.root, afterId),
    ]);
    const replayResults = options.replayResults
      ? (JSON.parse(
          await readFile(resolve(globals.root, options.replayResults), "utf8"),
        ) as ReplayResult[])
      : [];
    const report = createBehaviorReport(
      compareRuns(before, after),
      before,
      after,
      replayResults,
    );
    const markdown = behaviorReportMarkdown(report);
    if (options.format !== "json" && options.format !== "markdown")
      throw new Error("--format must be json or markdown.");
    await writeFile(
      resolve(globals.root, options.output),
      options.format === "json"
        ? JSON.stringify(report, null, 2) + "\n"
        : markdown,
      "utf8",
    );
    if (options.githubSummary) {
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (!summaryPath)
        throw new Error(
          "--github-summary requires the GITHUB_STEP_SUMMARY environment variable.",
        );
      await appendFile(summaryPath, markdown, "utf8");
    }
    if (options.githubAnnotations)
      for (const annotation of behaviorReportAnnotations(report))
        process.stderr.write(`${annotation}\n`);
    output(
      {
        output: resolve(globals.root, options.output),
        format: options.format,
        changed:
          report.added.length + report.removed.length + report.changed.length,
        minimumConfidence: report.reportMetadata.confidence.minimum,
        replay: report.reportMetadata.replay,
      },
      globals.json,
    );
    if (
      options.failOnChange &&
      report.added.length + report.removed.length + report.changed.length > 0
    )
      process.exitCode = 2;
    if (
      typeof options.failOnLowConfidence === "number" &&
      report.reportMetadata.confidence.minimum !== null &&
      report.reportMetadata.confidence.minimum < options.failOnLowConfidence
    )
      process.exitCode = 2;
  });

program
  .command("validate")
  .description("Validate statescry.config.json before a map or CI run.")
  .action(async (_options, command) => {
    const globals = globalOptions(command);
    const config = await loadConfig(globals.root);
    output(
      globals.json ? { valid: true, config } : "Configuration is valid.",
      globals.json,
    );
  });

program
  .command("matrix")
  .description("Map combinations of configured personas and viewports.")
  .argument("<url>", "application URL")
  .requiredOption(
    "--personas <names>",
    "comma-separated persona names",
    parseCsv,
  )
  .requiredOption(
    "--viewports <names>",
    "comma-separated viewport names",
    parseCsv,
  )
  .option("--max-states <count>", "state budget per combination", Number, 100)
  .option("--max-depth <count>", "depth budget per combination", Number, 8)
  .option("--workers <count>", "parallel local workers", Number, 2)
  .option("--resume", "resume completed cells from the versioned checkpoint")
  .option("--checkpoint <path>", "custom matrix checkpoint path")
  .option(
    "--allow-extensions",
    "load configured reviewed extensions in every cell",
  )
  .action(async (url, commandOptions, command) => {
    const globals = globalOptions(command);
    const cells = [];
    for (const persona of commandOptions.personas as string[]) {
      for (const viewport of commandOptions.viewports as string[]) {
        cells.push({
          key: `${persona}-${viewport}`,
          options: await resolveExploreOptions({
            baseUrl: url,
            projectRoot: globals.root,
            persona,
            viewport,
            maxStates: commandOptions.maxStates,
            maxDepth: commandOptions.maxDepth,
            name: `${persona}-${viewport}`,
            allowExtensions: commandOptions.allowExtensions === true,
          }),
        });
      }
    }
    const result = await runMappingMatrix(cells, {
      projectRoot: globals.root,
      maxWorkers: commandOptions.workers,
      resume: commandOptions.resume === true,
      ...(typeof commandOptions.checkpoint === "string"
        ? { checkpointPath: commandOptions.checkpoint }
        : {}),
    });
    output(
      globals.json
        ? result
        : result.runs.map(({ key, run }) => ({
            cell: key,
            id: run.id,
            name: run.name,
            role: run.persona.role,
            viewport: run.viewport.name,
            states: run.states.length,
            observed: run.stats.observedStates ?? run.states.length,
            reused: run.stats.reusedStates ?? 0,
          })),
      globals.json,
    );
  });

const extensions = program
  .command("extensions")
  .description("Validate and invoke explicit local extension modules.");

extensions
  .command("validate")
  .description("Validate manifest compatibility and declared handlers.")
  .argument("<module>", "local JavaScript extension module")
  .action(async (modulePath, _options, command) => {
    const globals = globalOptions(command);
    output(
      await inspectExtension(resolve(globals.root, modulePath)),
      globals.json,
    );
  });

extensions
  .command("invoke")
  .description("Invoke one declared capability with a JSON input file.")
  .argument("<module>", "local JavaScript extension module")
  .addOption(
    new Option("--capability <capability>", "declared capability")
      .choices(["actions", "assertions", "redactors", "matchers"])
      .makeOptionMandatory(),
  )
  .requiredOption("--input <path>", "JSON input file")
  .option("--timeout <milliseconds>", "override bounded timeout", Number)
  .action(async (modulePath, options, command) => {
    const globals = globalOptions(command);
    const input = JSON.parse(
      await readFile(resolve(globals.root, options.input), "utf8"),
    ) as unknown;
    output(
      await invokeExtension(
        resolve(globals.root, modulePath),
        options.capability as ExtensionCapability,
        input,
        options.timeout,
      ),
      globals.json,
    );
  });

program
  .command("history")
  .description("Show measured coverage history and labeled budget estimates.")
  .option("--limit <count>", "maximum recent runs", Number, 20)
  .action(async (options, command) => {
    const globals = globalOptions(command);
    const summaries = (await listRuns(globals.root)).slice(0, options.limit);
    const runs = await Promise.all(
      summaries.map((summary) => loadRun(globals.root, summary.id)),
    );
    output(calculateCoverageHistory(runs), globals.json);
  });

program
  .command("runs")
  .description("List saved behavior runs.")
  .action(async (_options, command) => {
    const globals = globalOptions(command);
    output(await listRuns(globals.root), globals.json);
  });

program
  .command("states")
  .description("List states in a behavior run.")
  .argument("<run>", "run ID or unique name")
  .option("--search <query>", "filter URL, title, heading, or text")
  .action(async (identifier, options, command) => {
    const globals = globalOptions(command);
    const run = await loadRun(globals.root, identifier);
    const query = String(options.search ?? "").toLowerCase();
    const states = run.states
      .filter((state) =>
        `${state.url} ${state.title} ${state.heading} ${state.textSample}`
          .toLowerCase()
          .includes(query),
      )
      .map((state) => ({
        id: state.id,
        depth: state.depth,
        heading: state.heading,
        title: state.title,
        url: state.url,
      }));
    output(states, globals.json);
  });

program
  .command("path")
  .description("Print the shortest known path to a state.")
  .argument("<run>", "run ID or unique name")
  .argument("<state>", "state ID")
  .action(async (identifier, stateId, _options, command) => {
    const globals = globalOptions(command);
    const run = await loadRun(globals.root, identifier);
    const path = shortestPath(run, stateId);
    if (path === null) throw new Error(`State ${stateId} is unreachable.`);
    output(
      path.map((step, index) => ({
        step: index + 1,
        action: step.action.label,
        selector: step.action.selector,
      })),
      globals.json,
    );
  });

program
  .command("replay")
  .description("Replay a discovered state and capture a fresh screenshot.")
  .argument("<run>", "run ID or unique name")
  .argument("<state>", "state ID")
  .option("--headed", "show the browser during replay")
  .action(async (identifier, stateId, options, command) => {
    const globals = globalOptions(command);
    const run = await loadRun(globals.root, identifier);
    const result = await replayState(run, stateId, {
      headless: !options.headed,
    });
    output(result, globals.json);
    if (result.status !== "verified") process.exitCode = 2;
  });

program
  .command("analyze")
  .description("Detect dead ends, cycles, and probable permission risks.")
  .argument("<run>", "run ID or unique name")
  .action(async (identifier, _options, command) => {
    const globals = globalOptions(command);
    output(analyzeRun(await loadRun(globals.root, identifier)), globals.json);
  });

program
  .command("diff")
  .description("Compare two behavior runs.")
  .argument("<before>", "baseline run ID or name")
  .argument("<after>", "candidate run ID or name")
  .option("--fail-on-risk", "exit with status 2 when risk signals exist")
  .action(async (beforeId, afterId, options, command) => {
    const globals = globalOptions(command);
    const [before, after] = await Promise.all([
      loadRun(globals.root, beforeId),
      loadRun(globals.root, afterId),
    ]);
    const diff = compareRuns(before, after);
    output(diff, globals.json);
    if (options.failOnRisk && diff.riskSignals.length > 0) {
      process.exitCode = 2;
    }
  });

program
  .command("access")
  .description("Compare state reachability for two role/persona runs.")
  .argument("<less-privileged>", "ordinary-user run ID or name")
  .argument("<privileged>", "admin/owner run ID or name")
  .action(async (lessId, privilegedId, _options, command) => {
    const globals = globalOptions(command);
    const [lessPrivileged, privileged] = await Promise.all([
      loadRun(globals.root, lessId),
      loadRun(globals.root, privilegedId),
    ]);
    output(compareRoleAccess(lessPrivileged, privileged), globals.json);
  });

function openBrowser(url: string): void {
  const browserCommand: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(browserCommand[0], browserCommand[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

program
  .command("show")
  .description("Start the local behavior-graph dashboard.")
  .option("--port <port>", "server port", Number, 4317)
  .option("--no-open", "do not open a browser")
  .action(async (options, command) => {
    const globals = globalOptions(command);
    printBanner(globals.json);
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const publicDirectory = resolve(packageRoot, "public");
    const dashboard = await startDashboardServer({
      projectRoot: globals.root,
      publicDirectory,
      port: options.port,
    });
    if (!globals.json && process.stdout.isTTY) {
      process.stdout.write(
        `\x1b[32m✔\x1b[0m StateScry dashboard running live at: \x1b[1;36m${dashboard.url}\x1b[0m\n`,
      );
    } else {
      process.stdout.write(`StateScry dashboard: ${dashboard.url}\n`);
    }
    if (options.open) openBrowser(dashboard.url);
  });

program
  .command("mcp")
  .description("Start the StateScry MCP server over stdio.")
  .action(async () => {
    const { startStateScryMcp } = await import("@statescry-tool/mcp");
    await startStateScryMcp();
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`StateScry: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
