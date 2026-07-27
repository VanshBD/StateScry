import { describe, expect, it } from "vitest";

import { validateConfig } from "../src/index.js";

describe("configuration validation", () => {
  it("rejects an allowlist mode without explicit request rules", () => {
    expect(() => validateConfig({ explorationMode: "allowlist" })).toThrow(
      /requires mutationAllowlist/,
    );
  });

  it("rejects malformed configured actions and shell-like hooks", () => {
    expect(() =>
      validateConfig({ customActions: [{ name: "bad", kind: "click" }] }),
    ).toThrow(/selector/);
    expect(() =>
      validateConfig({ resetHook: { command: "node", args: "not-an-array" } }),
    ).toThrow(/args string array/);
    expect(() =>
      validateConfig({ allowedOrigins: ["javascript:alert(1)"] }),
    ).toThrow(/HTTP\(S\) origins/);
    expect(() =>
      validateConfig({ viewports: { broken: { width: 0, height: 800 } } }),
    ).toThrow(/positive width/);
    expect(() =>
      validateConfig({
        replayAssertions: [{ type: "selector", expected: "visible" }],
      }),
    ).toThrow(/selector/);
  });

  it("accepts structured local hooks and configured form actions", () => {
    expect(
      validateConfig({
        inputs: [{ selector: "#email", value: "person@example.test" }],
        customActions: [
          {
            name: "choose plan",
            kind: "select",
            selector: "#plan",
            value: "pro",
          },
        ],
        resetHook: { command: "node", args: ["scripts/reset.mjs"] },
      }),
    ).toMatchObject({ inputs: [{ selector: "#email" }] });
  });
});
