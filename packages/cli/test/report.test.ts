import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { saveRun } from "@statescry/core";
import { afterEach, describe, expect, it } from "vitest";

import { run, state } from "../../core/test/fixtures.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function invoke(
  root: string,
  args: string[],
  environment: Record<string, string> = {},
) {
  const workspace = resolve(process.cwd());
  const tsx = resolve(workspace, "node_modules/tsx/dist/cli.mjs");
  const cli = resolve(workspace, "packages/cli/src/bin.ts");
  try {
    const result = await execFileAsync(
      process.execPath,
      [tsx, cli, "--root", root, "--json", ...args],
      {
        cwd: workspace,
        windowsHide: true,
        env: { ...process.env, ...environment },
      },
    );
    return { code: 0, ...result };
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("CLI behavior reports", () => {
  it("writes deterministic Markdown and JSON and returns exit 2 on changes", async () => {
    const root = await mkdtemp(resolve(process.cwd(), ".tmp-statescry-cli-"));
    temporaryRoots.push(root);
    await saveRun(
      run([state("root-before", "root", 0)], [], {
        id: "before",
        name: "before",
        projectRoot: root,
      }),
    );
    await saveRun(
      run(
        [state("root-after", "root", 0), state("new-state", "new-state", 1)],
        [],
        { id: "after", name: "after", projectRoot: root },
      ),
    );

    const summaryPath = resolve(root, "github-summary.md");
    const markdown = await invoke(
      root,
      [
        "report",
        "before",
        "after",
        "--output",
        "behavior.md",
        "--fail-on-change",
        "--github-summary",
        "--github-annotations",
      ],
      { GITHUB_STEP_SUMMARY: summaryPath },
    );
    expect(markdown.code).toBe(2);
    expect(await readFile(resolve(root, "behavior.md"), "utf8")).toContain(
      "| Added states | 1 |",
    );
    expect(await readFile(summaryPath, "utf8")).toContain("Coverage limits");
    expect(markdown.stderr).toContain("::warning title=StateScry");

    const json = await invoke(root, [
      "report",
      "before",
      "after",
      "--output",
      "behavior.json",
      "--format",
      "json",
    ]);
    expect(json.code).toBe(0);
    const report = JSON.parse(
      await readFile(resolve(root, "behavior.json"), "utf8"),
    ) as {
      added: unknown[];
      reachability: { assessed: boolean };
      reportMetadata: {
        confidence: { minimum: number | null };
        coverage: { candidate: string };
      };
    };
    expect(report.added).toHaveLength(1);
    expect(report.reachability.assessed).toBe(false);
    expect(report.reportMetadata.coverage.candidate).toMatch(/coverage/);
  }, 30_000);
});
