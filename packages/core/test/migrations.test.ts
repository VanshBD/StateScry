import { describe, expect, it } from "vitest";

import { migrateBehaviorRun, STATESCRY_SCHEMA_VERSION } from "../src/index.js";
import { run, state } from "./fixtures.js";

describe("behavior artifact migrations", () => {
  it("migrates legacy runs conservatively and labels unavailable counters", () => {
    const legacy = run([state("home", "home", 0)], [], {
      schemaVersion: 1,
    }) as unknown as Record<string, unknown>;
    const stats = legacy.stats as Record<string, unknown>;
    delete stats.coverage;
    const options = legacy.options as Record<string, unknown>;
    delete options.explorationMode;
    delete options.mutationAllowlist;
    delete options.evidenceMode;

    const migrated = migrateBehaviorRun(legacy);
    expect(migrated.schemaVersion).toBe(STATESCRY_SCHEMA_VERSION);
    expect(migrated.options).toMatchObject({
      explorationMode: "observe",
      mutationAllowlist: [],
      extensionsEnabled: false,
    });
    expect(migrated.stats.coverage.statement).toMatch(/Migrated legacy run/);
    expect(migrated.states[0]?.provenance).toEqual({ kind: "observed" });
    expect(migrated.warnings.at(-1)).toMatch(/migrated in memory/);
  });

  it("rejects future schemas instead of guessing", () => {
    expect(() =>
      migrateBehaviorRun(
        run([], [], { schemaVersion: STATESCRY_SCHEMA_VERSION + 1 }),
      ),
    ).toThrow(/newer than supported/);
  });
});
