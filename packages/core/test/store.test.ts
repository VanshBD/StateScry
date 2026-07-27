import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  graphPath,
  listRuns,
  loadRun,
  saveRun,
  startDashboardServer,
} from "../src/index.js";
import { run, state, transition } from "./fixtures.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("artifact store", () => {
  it("persists the JSON artifact and SQLite index", async () => {
    const projectRoot = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-"),
    );
    created.push(projectRoot);
    const behaviorRun = run(
      [state("root", "root", 0), state("next", "next", 1)],
      [transition("root-next", "root", "next")],
      { id: "persisted", name: "baseline", projectRoot },
    );

    await saveRun(behaviorRun);
    expect(
      JSON.parse(await readFile(graphPath(projectRoot, "persisted"), "utf8")),
    ).toMatchObject({
      id: "persisted",
      name: "baseline",
    });
    expect(await listRuns(projectRoot)).toHaveLength(1);
    expect((await loadRun(projectRoot, "baseline")).id).toBe("persisted");
  });

  it("keeps private local paths out of dashboard responses", async () => {
    const projectRoot = await mkdtemp(
      resolve(process.cwd(), ".tmp-statescry-"),
    );
    created.push(projectRoot);
    const behaviorRun = run([state("root", "root", 0)], [], {
      id: "private-run",
      projectRoot,
      persona: {
        name: "customer",
        role: "customer",
        storageStatePath: resolve(projectRoot, "private-auth.json"),
      },
    });
    await saveRun(behaviorRun);
    const dashboard = await startDashboardServer({
      projectRoot,
      publicDirectory: projectRoot,
      port: 0,
    });
    try {
      const response = await fetch(`${dashboard.url}/api/runs/private-run`);
      const exposed = (await response.json()) as {
        projectRoot: string;
        persona: { storageStatePath?: string };
      };
      expect(exposed.projectRoot).toBe("[local project]");
      expect(exposed.persona.storageStatePath).toBeUndefined();
      const historyResponse = await fetch(`${dashboard.url}/api/history`);
      const history = (await historyResponse.json()) as {
        points: Array<{ runId: string }>;
      };
      expect(history.points).toEqual([
        {
          runId: "private-run",
          completedAt: expect.any(String),
          measured: expect.any(Object),
        },
      ]);
    } finally {
      await dashboard.close();
    }
  });
});
