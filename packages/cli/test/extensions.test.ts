import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

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

describe("extension CLI", () => {
  it("validates and invokes an explicit local extension", async () => {
    const root = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-extensions-"),
    );
    roots.push(root);
    await writeFile(
      resolve(root, "extension.mjs"),
      `export default {
  manifest: { schemaVersion: 1, apiVersion: 1, name: 'cli-extension', version: '1.0.0', capabilities: ['redactors'] },
  redactors: input => ({ text: input.text.replace(/ACCT-\\d+/g, '[account]') })
};\n`,
      "utf8",
    );
    await writeFile(
      resolve(root, "input.json"),
      JSON.stringify({ label: "account", text: "ACCT-123" }),
      "utf8",
    );
    const validation = await invoke(root, [
      "extensions",
      "validate",
      "extension.mjs",
    ]);
    expect(JSON.parse(validation.stdout)).toMatchObject({
      manifest: { name: "cli-extension", apiVersion: 1 },
    });
    const invocation = await invoke(root, [
      "extensions",
      "invoke",
      "extension.mjs",
      "--capability",
      "redactors",
      "--input",
      "input.json",
    ]);
    expect(JSON.parse(invocation.stdout)).toMatchObject({
      extension: "cli-extension@1.0.0",
      capability: "redactors",
      result: { text: "[account]" },
    });
  }, 30_000);
});
