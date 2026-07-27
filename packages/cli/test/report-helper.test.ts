import { describe, expect, it } from "vitest";

import { compareRuns } from "@statescry/core";

import { run, state } from "../../core/test/fixtures.js";
import {
  behaviorReportAnnotations,
  behaviorReportMarkdown,
  createBehaviorReport,
} from "../src/report.js";

describe("PR-friendly behavior report", () => {
  it("includes confidence, coverage, replay, details, and safe annotations", () => {
    const before = run([state("home-before", "home", 0)], [], {
      id: "before",
    });
    const after = run(
      [
        state("home-after", "home", 0),
        state("settings", "settings", 1, { heading: "Settings\nchanged" }),
      ],
      [],
      { id: "after" },
    );
    const report = createBehaviorReport(
      compareRuns(before, after),
      before,
      after,
      [
        {
          status: "failed",
          requestedStateId: "settings",
          requestedUrl: "http://example.test/settings",
          finalUrl: "http://example.test/",
          title: "Home",
          heading: "Home",
          fingerprint: "different",
          steps: 1,
          mismatches: [],
        },
      ],
    );
    const markdown = behaviorReportMarkdown(report);
    expect(markdown).toContain("Match confidence");
    expect(markdown).toContain("Coverage limits");
    expect(markdown).toContain("Replay verified | 0/1");
    expect(markdown).toContain("not proof of complete application");
    expect(report.reportMetadata.replay).toMatchObject({
      attempts: 1,
      verified: 0,
      failed: 1,
    });
    expect(behaviorReportAnnotations(report).join("\n")).not.toContain(
      "Settings\nchanged",
    );
  });
});
