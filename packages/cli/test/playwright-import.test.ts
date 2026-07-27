import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { importPlaywrightJourneys } from "../src/playwright-import.js";

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

describe("safe Playwright journey import", () => {
  it("parses literal locator actions, redacts secrets, and reports unsupported constructs", async () => {
    const root = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-import-"),
    );
    roots.push(root);
    await writeFile(
      resolve(root, "checkout.spec.ts"),
      `import { test, expect } from '@playwright/test';
test('checkout', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/checkout');
  await page.locator('#email').fill('user@example.test');
  await page.locator('#password').fill('must-not-persist');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('[data-testid="continue"]').click();
  if (process.env.EXTRA) await page.locator('#conditional').click();
  await expect(page.locator('#confirmation')).toBeVisible();
});
`,
      "utf8",
    );

    const first = await importPlaywrightJourneys(
      root,
      ["checkout.spec.ts"],
      ".statescry/imports/journeys.json",
    );
    const second = await importPlaywrightJourneys(
      root,
      ["checkout.spec.ts"],
      ".statescry/imports/journeys-copy.json",
    );

    expect(first).toEqual(second);
    expect(first.summary).toMatchObject({
      files: 1,
      journeys: 1,
      steps: 3,
      assertions: 1,
    });
    expect(first.journeys[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: "#email",
          value: "user@example.test",
        }),
        expect.objectContaining({
          selector: "#password",
          secretValue: true,
        }),
        expect.objectContaining({ selector: '[data-testid="continue"]' }),
      ]),
    );
    expect(JSON.stringify(first)).not.toContain("must-not-persist");
    expect(first.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["UNSUPPORTED_LOCATOR", "CONDITIONAL_FLOW"]),
    );
    expect(
      JSON.parse(
        await readFile(
          resolve(root, ".statescry/imports/journeys.json"),
          "utf8",
        ),
      ),
    ).toEqual(first);
  });

  it("writes the versioned artifact through the real CLI command", async () => {
    const root = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-import-cli-"),
    );
    roots.push(root);
    await writeFile(
      resolve(root, "smoke.spec.ts"),
      "test('smoke', async ({ page }) => { await page.goto('http://127.0.0.1:3000'); await page.locator('#open').click(); });\n",
      "utf8",
    );

    const result = await invoke(root, [
      "import-playwright",
      "smoke.spec.ts",
      "--output",
      "journeys.json",
    ]);
    const output = JSON.parse(result.stdout) as {
      summary: { journeys: number; steps: number };
    };
    const artifact = JSON.parse(
      await readFile(resolve(root, "journeys.json"), "utf8"),
    ) as { schemaVersion: number };

    expect(output.summary).toMatchObject({ journeys: 1, steps: 1 });
    expect(artifact.schemaVersion).toBe(1);
  }, 20_000);
});
