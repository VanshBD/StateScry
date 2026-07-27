import { describe, expect, it } from "vitest";

import {
  evaluateBenchmark,
  type BenchmarkManifest,
  type ReplayResult,
} from "../src/index.js";
import { run, state, transition } from "./fixtures.js";

const manifest: BenchmarkManifest = {
  schemaVersion: 1,
  name: "checkout fixture",
  states: [
    { logicalKey: "home" },
    { logicalKey: "checkout", replayRequired: true },
    { logicalKey: "receipt" },
  ],
  transitions: [
    { source: "home", target: "checkout" },
    { source: "checkout", target: "receipt" },
  ],
  diff: { added: ["receipt"], changed: ["checkout"] },
  safety: { maximumCompletedUnapprovedMutations: 0 },
  privacy: { maximumDetectedSecretLeaks: 0 },
};

function verifiedReplay(stateId: string): ReplayResult {
  return {
    status: "verified",
    requestedStateId: stateId,
    requestedUrl: "http://example.test/checkout",
    finalUrl: "http://example.test/checkout",
    title: "Checkout",
    heading: "Checkout",
    fingerprint: "checkout",
    steps: 1,
    mismatches: [],
  };
}

describe("objective benchmark scoring", () => {
  it("scores a completely labeled mapping, diff, replay, safety, and privacy result", () => {
    const before = run(
      [
        state("home-before", "home", 0, {
          fingerprint: "home-fingerprint",
          url: "http://example.test/home",
          normalizedUrl: "http://example.test/home",
          title: "Home",
          heading: "Home",
        }),
        state("checkout-before", "checkout", 1, {
          fingerprint: "checkout-fingerprint",
          url: "http://example.test/checkout",
          normalizedUrl: "http://example.test/checkout",
          title: "Checkout",
          heading: "Checkout",
          outgoingActionCount: 2,
        }),
      ],
      [transition("before-checkout", "home-before", "checkout-before")],
      { id: "before" },
    );
    const after = run(
      [
        state("home-after", "home", 0, {
          fingerprint: "home-fingerprint",
          url: "http://example.test/home",
          normalizedUrl: "http://example.test/home",
          title: "Home",
          heading: "Home",
        }),
        state("checkout-after", "checkout", 1, {
          fingerprint: "checkout-fingerprint",
          url: "http://example.test/checkout",
          normalizedUrl: "http://example.test/checkout",
          title: "Checkout",
          heading: "Checkout",
          outgoingActionCount: 1,
        }),
        state("receipt-after", "receipt", 2),
      ],
      [
        transition("after-checkout", "home-after", "checkout-after"),
        transition("after-receipt", "checkout-after", "receipt-after"),
      ],
      { id: "after" },
    );

    const result = evaluateBenchmark(manifest, {
      run: after,
      beforeRun: before,
      replayResults: [verifiedReplay("checkout-after")],
      completedUnapprovedMutations: 0,
      detectedSecretLeaks: 0,
    });

    expect(result).toMatchObject({ passed: true, score: 1 });
    expect(result.metrics).toMatchObject({
      stateRecall: { score: 1, passed: true },
      statePrecision: { score: 1, passed: true },
      duplicateRate: { score: 0, passed: true },
      transitionRecall: { score: 1, passed: true },
      diffPrecision: { score: 1, passed: true },
      diffRecall: { score: 1, passed: true },
      replayReliability: { score: 1, passed: true },
      safety: { score: 1, passed: true },
      privacy: { score: 1, passed: true },
    });
  });

  it("fails honestly when discovery is incomplete, duplicated, unsafe, or leaks secrets", () => {
    const incomplete = run(
      [state("home", "home", 0), state("home-copy", "home", 0)],
      [],
      { id: "incomplete" },
    );
    const result = evaluateBenchmark(manifest, {
      run: incomplete,
      replayResults: [],
      completedUnapprovedMutations: 1,
      detectedSecretLeaks: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.metrics.stateRecall?.score).toBeCloseTo(1 / 3, 4);
    expect(result.metrics.duplicateRate).toMatchObject({
      score: 0.5,
      passed: false,
    });
    expect(result.metrics.safety?.passed).toBe(false);
    expect(result.metrics.privacy?.passed).toBe(false);
    expect(result.limitations[0]).toMatch(/independently reviewed/);
  });

  it("rejects duplicate inventory keys", () => {
    expect(() =>
      evaluateBenchmark(
        {
          schemaVersion: 1,
          name: "invalid",
          states: [{ logicalKey: "home" }, { logicalKey: "home" }],
        },
        { run: run([state("home", "home", 0)], []) },
      ),
    ).toThrow(/must be unique/);
  });

  it("fails required safety and privacy metrics when outcomes are omitted", () => {
    const result = evaluateBenchmark(manifest, {
      run: run(
        [
          state("home", "home", 0),
          state("checkout", "checkout", 1),
          state("receipt", "receipt", 2),
        ],
        [],
      ),
    });
    expect(result.metrics.safety).toMatchObject({ score: 0, passed: false });
    expect(result.metrics.privacy).toMatchObject({ score: 0, passed: false });
  });
});
