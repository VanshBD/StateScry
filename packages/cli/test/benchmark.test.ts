import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  try {
    const result = await execFileAsync(
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

describe("CLI benchmark reports", () => {
  it("writes a deterministic score report and exits 2 below thresholds", async () => {
    const root = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-benchmark-"),
    );
    roots.push(root);
    await saveRun(
      run([state("home", "home", 0)], [], {
        id: "candidate",
        projectRoot: root,
      }),
    );
    await writeFile(
      resolve(root, "benchmark.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        name: "CLI fixture",
        states: [{ logicalKey: "home" }, { logicalKey: "checkout" }],
      })}\n`,
    );

    const result = await invoke(root, [
      "benchmark",
      "candidate",
      "--manifest",
      "benchmark.json",
      "--output",
      "benchmark.md",
    ]);
    expect(result.code).toBe(2);
    const report = await readFile(resolve(root, "benchmark.md"), "utf8");
    expect(report).toContain("**Overall:**");
    expect(report).toContain("stateRecall");
    expect(report).toContain("Interpretation limits");

    const informational = await invoke(root, [
      "benchmark",
      "candidate",
      "--manifest",
      "benchmark.json",
      "--no-fail-on-threshold",
    ]);
    expect(informational.code).toBe(0);
  }, 30_000);
});
