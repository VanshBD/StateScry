import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectExtension,
  invokeExtension,
  type ExtensionAction,
  type ExtensionAssertionResult,
  type ExtensionMatcherResult,
  type ExtensionRedactorResult,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function extension(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "statescry-extension-"));
  roots.push(root);
  const path = resolve(root, "extension.mjs");
  await writeFile(path, source, "utf8");
  return path;
}

const manifest = `{
  schemaVersion: 1,
  apiVersion: 1,
  name: 'invoice-domain',
  version: '1.0.0',
  capabilities: ['actions', 'assertions', 'redactors', 'matchers'],
  timeoutMs: 500
}`;

describe("extension host", () => {
  it("keeps API v1 extensions compatible across extension version upgrades", async () => {
    for (const version of ["1.0.0", "1.1.0", "2.0.0"]) {
      const path = await extension(`
export default {
  manifest: { schemaVersion: 1, apiVersion: 1, name: 'versioned-domain', version: '${version}', capabilities: ['assertions'] },
  assertions: input => ({ passed: input.expected === '${version}', actual: '${version}', explanation: 'versioned fixture' })
};
`);
      const inspected = await inspectExtension(path);
      expect(inspected.manifest.version).toBe(version);
      await expect(
        invokeExtension<ExtensionAssertionResult>(path, "assertions", {
          name: "version compatibility",
          expected: version,
          snapshot: {
            url: "http://example.test",
            title: "Version",
            heading: "Version",
            textSample: "Version",
            role: "test",
            viewport: { name: "desktop", width: 1024, height: 768 },
            featureContext: {},
          },
        }),
      ).resolves.toMatchObject({ result: { passed: true, actual: version } });
    }
  });

  it("invokes every declared capability with validation and redacted input", async () => {
    const path = await extension(`
export default {
  manifest: ${manifest},
  actions: snapshot => [{
    name: 'Open ' + snapshot.featureContext.apiToken + ':' + (process.env.PRIVATE_TOKEN ?? 'no-env'),
    kind: 'click', selector: '#invoice'
  }],
  assertions: input => ({ passed: input.snapshot.heading === input.expected, actual: input.snapshot.heading, explanation: 'exact heading' }),
  redactors: input => ({ text: input.text.replace(/INV-\\d+/g, '[invoice]') }),
  matchers: input => ({ score: input.before.heading === input.after.heading ? 1 : 0.25, explanation: 'domain heading comparison' })
};
`);
    const snapshot = {
      url: "http://example.test/invoices",
      title: "Invoices",
      heading: "Invoices",
      textSample: "INV-123",
      role: "accountant",
      viewport: { name: "desktop", width: 1440, height: 900 },
      featureContext: { apiToken: "must-not-reach-extension" },
    };
    const inspected = await inspectExtension(path);
    expect(inspected.manifest.capabilities).toHaveLength(4);
    const actions = await invokeExtension<ExtensionAction[]>(
      path,
      "actions",
      snapshot,
    );
    expect(actions.result[0]).toMatchObject({
      name: "Open [REDACTED]:no-env",
      selector: "#invoice",
    });
    expect(JSON.stringify(actions)).not.toContain("must-not-reach-extension");
    await expect(
      invokeExtension<ExtensionAssertionResult>(path, "assertions", {
        name: "invoice heading",
        expected: "Invoices",
        snapshot,
      }),
    ).resolves.toMatchObject({ result: { passed: true } });
    await expect(
      invokeExtension<ExtensionRedactorResult>(path, "redactors", {
        label: "invoice text",
        text: "Invoice INV-123",
      }),
    ).resolves.toMatchObject({ result: { text: "Invoice [invoice]" } });
    await expect(
      invokeExtension<ExtensionMatcherResult>(path, "matchers", {
        before: snapshot,
        after: snapshot,
      }),
    ).resolves.toMatchObject({ result: { score: 1 } });
  });

  it("rejects incompatible, incomplete, malformed, timed-out, and crashed extensions", async () => {
    const incompatible = await extension(
      `export default { manifest: { schemaVersion: 1, apiVersion: 2, name: 'bad', version: '1.0.0', capabilities: ['actions'] }, actions: () => [] };`,
    );
    await expect(inspectExtension(incompatible)).rejects.toThrow(
      /incompatible/,
    );

    const incomplete = await extension(
      `export default { manifest: { schemaVersion: 1, apiVersion: 1, name: 'missing', version: '1.0.0', capabilities: ['actions'] } };`,
    );
    await expect(inspectExtension(incomplete)).rejects.toThrow(
      /does not export/,
    );

    const malformed = await extension(
      `export default { manifest: { schemaVersion: 1, apiVersion: 1, name: 'malformed', version: '1.0.0', capabilities: ['matchers'] }, matchers: () => ({ score: 5, explanation: 'invalid' }) };`,
    );
    await expect(invokeExtension(malformed, "matchers", {})).rejects.toThrow(
      /0\.\.1 score/,
    );

    const timeout = await extension(
      `export default { manifest: { schemaVersion: 1, apiVersion: 1, name: 'slow', version: '1.0.0', capabilities: ['actions'], timeoutMs: 20 }, actions: () => new Promise(() => {}) };`,
    );
    await expect(invokeExtension(timeout, "actions", {})).rejects.toThrow(
      /timed out/,
    );

    const crash = await extension(
      `export default { manifest: { schemaVersion: 1, apiVersion: 1, name: 'crash', version: '1.0.0', capabilities: ['actions'] }, actions: () => process.exit(9) };`,
    );
    await expect(invokeExtension(crash, "actions", {})).rejects.toThrow(
      /exited unexpectedly/,
    );
  });
});
