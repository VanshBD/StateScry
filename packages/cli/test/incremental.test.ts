import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { saveRun } from "@statescry/core";
import { afterEach, describe, expect, it } from "vitest";

import { run, state } from "../../core/test/fixtures.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function invoke(root: string, args: string[]) {
  const workspace = resolve(process.cwd());
  return execFileAsync(
    process.execPath,
    [
      resolve(workspace, "node_modules/tsx/dist/cli.mjs"),
      resolve(workspace, "packages/cli/src/bin.ts"),
      "--root",
      root,
      "--json",
      ...args,
    ],
    { cwd: workspace, windowsHide: true },
  );
}

describe("incremental CLI workflows", () => {
  it("reports measured history and exposes explicit incremental controls", async () => {
    const root = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-incremental-"),
    );
    roots.push(root);
    await saveRun(
      run([state("home-one", "home", 0)], [], {
        id: "history-one",
        projectRoot: root,
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await saveRun(
      run([state("home-two", "home", 0), state("about", "about", 1)], [], {
        id: "history-two",
        projectRoot: root,
        completedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    const history = await invoke(root, ["history"]);
    const parsed = JSON.parse(history.stdout) as {
      points: unknown[];
      measuredTrend: { stateDelta: number };
      limitations: string[];
    };
    expect(parsed.points).toHaveLength(2);
    expect(parsed.measuredTrend.stateDelta).toBe(1);
    expect(parsed.limitations[0]).toMatch(/measured/);

    const help = await invoke(root, ["map", "--help"]);
    expect(help.stdout).toContain("--incremental-from <run>");
    expect(help.stdout).toContain("--force-full");
  }, 30_000);
});
