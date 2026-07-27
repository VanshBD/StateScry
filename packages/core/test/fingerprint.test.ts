import { describe, expect, it } from "vitest";

import {
  createFingerprint,
  normalizeSnapshot,
  normalizeUrl,
} from "../src/index.js";

describe("behavior fingerprinting", () => {
  it("removes volatile URL details and sorts stable parameters", () => {
    expect(
      normalizeUrl("https://app.test/cart/?z=2&timestamp=123&a=1#panel"),
    ).toBe("https://app.test/cart?a=1&z=2#panel");
  });

  it("normalizes timestamps, UUIDs, and long counters", () => {
    expect(
      normalizeSnapshot(
        "Order 550e8400-e29b-41d4-a716-446655440000 at 2026-07-25T10:30:00Z number 123456789",
      ),
    ).toBe("Order [uuid] at [datetime] number [number]");
  });

  it("keeps role and viewport in the state identity", () => {
    const base = {
      url: "https://app.test/settings",
      title: "Settings",
      heading: "Account settings",
      accessibilitySnapshot: '- heading "Account settings"',
      role: "customer",
      viewport: { name: "desktop", width: 1440, height: 900 },
      featureContext: {},
    };
    const customer = createFingerprint(base);
    const admin = createFingerprint({ ...base, role: "admin" });
    const mobile = createFingerprint({
      ...base,
      viewport: { name: "mobile", width: 390, height: 844 },
    });
    expect(customer.fingerprint).not.toBe(admin.fingerprint);
    expect(customer.fingerprint).not.toBe(mobile.fingerprint);
  });
});
