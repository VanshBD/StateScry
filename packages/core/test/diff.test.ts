import { describe, expect, it } from "vitest";

import { compareRoleAccess, compareRuns } from "../src/index.js";
import { run, state, transition } from "./fixtures.js";

describe("behavior comparison", () => {
  it("reports added, removed, changed, and longer journeys", () => {
    const before = run(
      [
        state("root", "root", 0),
        state("checkout-old", "checkout", 1, {
          outgoingActionCount: 2,
        }),
        state("removed", "removed", 1),
      ],
      [
        transition("root-checkout", "root", "checkout-old"),
        transition("root-removed", "root", "removed"),
      ],
      { id: "before", name: "before" },
    );
    const after = run(
      [
        state("root-new", "root", 0),
        state("checkout-new", "checkout", 4, {
          outgoingActionCount: 1,
        }),
        state("added", "added", 1),
      ],
      [
        transition("root-checkout-new", "root-new", "checkout-new"),
        transition("root-added", "root-new", "added"),
      ],
      { id: "after", name: "after" },
    );

    const diff = compareRuns(before, after);
    expect(diff.added.map((item) => item.id)).toEqual(["added"]);
    expect(diff.removed.map((item) => item.id)).toEqual(["removed"]);
    expect(
      diff.changed.find((item) => item.logicalKey === "checkout")?.reasons,
    ).toContain("available actions changed from 2 to 1");
    expect(diff.journeys[0]?.delta).toBe(3);
  });

  it("compares reachability between ordinary and privileged roles", () => {
    const customerState = state("customer-refund", "customer-refund", 1, {
      url: "http://example.test/refunds",
      normalizedUrl: "http://example.test/refunds",
      title: "Refunds",
      heading: "Admin refund console",
      textSample: "Approve refund",
    });
    const adminState = state("admin-refund", "admin-refund", 1, {
      url: "http://example.test/refunds",
      normalizedUrl: "http://example.test/refunds",
      title: "Refunds",
      heading: "Admin refund console",
      textSample: "Approve refund",
      role: "admin",
      persona: "admin",
    });
    const customer = run([state("root", "root", 0), customerState], [], {
      id: "customer-run",
    });
    const admin = run([state("admin-root", "admin-root", 0), adminState], [], {
      id: "admin-run",
      persona: { name: "admin", role: "admin" },
    });

    const access = compareRoleAccess(customer, admin);
    expect(access.sharedStates).toHaveLength(1);
    expect(access.suspiciousExposure).toHaveLength(1);
  });

  it("does not report normalized dynamic data as a behavior change", () => {
    const before = run(
      [
        state("order-old", "order", 1, {
          fingerprint: "stable-order-fingerprint",
          normalizedUrl: "http://example.test/orders/42",
          heading: "Order",
          textSample: "Updated 2026-01-01T10:00:00Z",
        }),
      ],
      [],
    );
    const after = run(
      [
        state("order-new", "order", 1, {
          fingerprint: "stable-order-fingerprint",
          normalizedUrl: "http://example.test/orders/42",
          heading: "Order",
          textSample: "Updated 2026-07-25T18:30:00Z",
        }),
      ],
      [],
    );

    const diff = compareRuns(before, after);
    expect(diff.matches?.[0]).toMatchObject({
      confidence: 1,
      method: "exact_fingerprint",
    });
    expect(diff).toMatchObject({ added: [], removed: [], changed: [] });
  });

  it("never matches states across role or device contexts", () => {
    const customer = run([state("customer-state", "settings", 0)], []);
    const admin = run(
      [
        state("admin-state", "settings", 0, {
          role: "admin",
          persona: "admin",
        }),
      ],
      [],
      { persona: { name: "admin", role: "admin" } },
    );
    const mobile = run(
      [
        state("mobile-state", "settings", 0, {
          viewport: { name: "mobile", width: 390, height: 844 },
        }),
      ],
      [],
      { viewport: { name: "mobile", width: 390, height: 844 } },
    );

    expect(compareRuns(customer, admin).matches).toHaveLength(0);
    expect(compareRuns(customer, mobile).matches).toHaveLength(0);
  });
});
