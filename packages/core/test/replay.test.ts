import { describe, expect, it } from "vitest";

import { evaluateReplayValueAssertion } from "../src/index.js";

const values = {
  url: "https://app.test/orders?timestamp=123",
  title: "Orders",
  heading: "Order history",
  text: "Three completed orders",
};

describe("replay assertions", () => {
  it("evaluates URL, title, heading, text, contains, and regex assertions", () => {
    expect(
      evaluateReplayValueAssertion(
        { type: "title", expected: "Orders" },
        values,
      ),
    ).toBeNull();
    expect(
      evaluateReplayValueAssertion(
        { type: "heading", expected: "history", mode: "contains" },
        values,
      ),
    ).toBeNull();
    expect(
      evaluateReplayValueAssertion(
        { type: "text", expected: "^Three", mode: "matches" },
        values,
      ),
    ).toBeNull();
    expect(
      evaluateReplayValueAssertion(
        { type: "url", expected: "https://app.test/orders" },
        values,
      ),
    ).toBeNull();
  });

  it("returns useful mismatches instead of treating invalid regex as success", () => {
    expect(
      evaluateReplayValueAssertion(
        { type: "heading", expected: "Checkout" },
        values,
      ),
    ).toMatchObject({
      field: "assertion",
      actual: "Order history",
    });
    expect(
      evaluateReplayValueAssertion(
        { type: "text", expected: "[", mode: "matches" },
        values,
      )?.message,
    ).toMatch(/invalid regular expression/);
  });
});
