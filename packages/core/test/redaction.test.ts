import { describe, expect, it } from "vitest";

import {
  classifyAction,
  redactText,
  redactUrl,
  requestAllowed,
} from "../src/index.js";

describe("safety boundaries", () => {
  it("blocks destructive action names", () => {
    expect(classifyAction("Delete customer account").risk).toBe("blocked");
    expect(classifyAction("Confirm purchase").risk).toBe("blocked");
    expect(classifyAction("View details").risk).toBe("safe");
  });

  it("redacts credentials and sensitive query values", () => {
    expect(redactText("Authorization: Bearer abc.def.ghi")).not.toContain(
      "abc.def.ghi",
    );
    expect(
      redactUrl("https://app.test/callback?token=secret-value&next=home"),
    ).toContain("token=%5BREDACTED%5D");
  });

  it("requires an exact explicit allowlist rule for mutations", () => {
    expect(
      requestAllowed("POST", "https://app.test/api/orders", "observe", []),
    ).toMatchObject({ allowed: false });
    expect(
      requestAllowed("POST", "https://app.test/api/orders", "allowlist", [
        { method: "POST", urlPattern: "https://app.test/api/orders" },
      ]),
    ).toEqual({ allowed: true });
    expect(
      requestAllowed("DELETE", "https://app.test/api/orders", "allowlist", [
        { method: "POST", urlPattern: "https://app.test/api/*" },
      ]),
    ).toMatchObject({ allowed: false });
  });
});
