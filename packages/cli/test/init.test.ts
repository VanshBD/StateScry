import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { detectProject, initializeProject } from "../src/init.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

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

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function project(packageJson: object): Promise<string> {
  const root = await mkdtemp(resolve(process.cwd(), ".tmp-statescry-init-"));
  roots.push(root);
  await writeFile(
    resolve(root, "package.json"),
    `${JSON.stringify(packageJson)}\n`,
    "utf8",
  );
  return root;
}

describe("one-command onboarding", () => {
  it("detects a Vite React project and writes a safe validated config", async () => {
    const root = await project({
      dependencies: { react: "latest", vite: "latest" },
    });
    await writeFile(
      resolve(root, "playwright.config.ts"),
      "export default {};\n",
    );
    const result = await initializeProject(root);
    const config = JSON.parse(
      await readFile(resolve(root, "statescry.config.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result).toMatchObject({
      framework: "React + Vite",
      baseUrl: "http://127.0.0.1:5173",
      playwrightConfigured: true,
    });
    expect(config).toMatchObject({
      explorationMode: "observe",
      evidenceMode: "metadata",
      allowedOrigins: ["http://127.0.0.1:5173"],
    });
    expect(result.nextCommands[1]).toContain("statescry map");
  });

  it("refuses accidental overwrite and requires explicit force", async () => {
    const root = await project({});
    await initializeProject(root, "http://127.0.0.1:8080");
    await expect(initializeProject(root)).rejects.toThrow(/already exists/);
    await expect(
      initializeProject(root, "http://127.0.0.1:9000", true),
    ).resolves.toMatchObject({ baseUrl: "http://127.0.0.1:9000" });
  });

  it("detects common framework defaults without executing project code", async () => {
    const root = await project({ dependencies: { "@angular/core": "latest" } });
    await expect(detectProject(root)).resolves.toMatchObject({
      framework: "Angular",
      defaultUrl: "http://127.0.0.1:4200",
    });
  });

  it("exposes onboarding through the real CLI command", async () => {
    const root = await project({ devDependencies: { next: "latest" } });
    const result = await invoke(root, ["init"]);
    const output = JSON.parse(result.stdout) as Record<string, string>;

    expect(output).toMatchObject({
      framework: "Next.js",
      baseUrl: "http://127.0.0.1:3000",
    });
    await expect(
      readFile(resolve(root, "statescry.config.json"), "utf8"),
    ).resolves.toContain('"explorationMode": "observe"');
  }, 20_000);
});
