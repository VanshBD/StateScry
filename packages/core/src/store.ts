import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { StateScryError } from "./errors.js";
import { summarizeRun } from "./diff.js";
import { migrateBehaviorRun } from "./migrations.js";
import type { BehaviorRun, RunSummary } from "./types.js";

export function stateScryDirectory(projectRoot: string): string {
  return resolve(projectRoot, ".statescry");
}

export function runDirectory(projectRoot: string, runId: string): string {
  return resolve(stateScryDirectory(projectRoot), "runs", runId);
}

export function graphPath(projectRoot: string, runId: string): string {
  return resolve(runDirectory(projectRoot, runId), "graph.json");
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function openDatabase(projectRoot: string): DatabaseSync {
  const path = resolve(stateScryDirectory(projectRoot), "statescry.db");
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      role TEXT NOT NULL,
      viewport TEXT NOT NULL,
      states INTEGER NOT NULL,
      transitions INTEGER NOT NULL,
      truncated INTEGER NOT NULL,
      graph_path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_name_idx ON runs(name);
    CREATE TABLE IF NOT EXISTS states (
      run_id TEXT NOT NULL,
      id TEXT NOT NULL,
      logical_key TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      heading TEXT NOT NULL,
      depth INTEGER NOT NULL,
      PRIMARY KEY (run_id, id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS states_logical_key_idx
      ON states(run_id, logical_key);
    CREATE TABLE IF NOT EXISTS transitions (
      run_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      action_label TEXT NOT NULL,
      PRIMARY KEY (run_id, id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
  `);
  return database;
}

export async function initializeStore(projectRoot: string): Promise<void> {
  await mkdir(resolve(stateScryDirectory(projectRoot), "runs"), {
    recursive: true,
  });
  const database = openDatabase(projectRoot);
  database.close();
}

export async function saveRun(run: BehaviorRun): Promise<void> {
  run = migrateBehaviorRun(run);
  const path = graphPath(run.projectRoot, run.id);
  await ensureParent(path);
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");

  const database = openDatabase(run.projectRoot);
  try {
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare(
        `INSERT OR REPLACE INTO runs
          (id, name, project_name, base_url, started_at, completed_at, role,
           viewport, states, transitions, truncated, graph_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.name,
        run.projectName,
        run.baseUrl,
        run.startedAt,
        run.completedAt,
        run.persona.role,
        run.viewport.name,
        run.states.length,
        run.transitions.length,
        run.stats.truncated ? 1 : 0,
        path,
      );
    database.prepare("DELETE FROM states WHERE run_id = ?").run(run.id);
    database.prepare("DELETE FROM transitions WHERE run_id = ?").run(run.id);
    const insertState = database.prepare(
      `INSERT INTO states
        (run_id, id, logical_key, url, title, heading, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const state of run.states) {
      insertState.run(
        run.id,
        state.id,
        state.logicalKey,
        state.url,
        state.title,
        state.heading,
        state.depth,
      );
    }
    const insertTransition = database.prepare(
      `INSERT INTO transitions
        (run_id, id, source, target, action_label)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const transition of run.transitions) {
      insertTransition.run(
        run.id,
        transition.id,
        transition.source,
        transition.target,
        transition.action.label,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

interface RunRow {
  id: string;
  name: string;
  project_name: string;
  base_url: string;
  started_at: string;
  completed_at: string;
  role: string;
  viewport: string;
  states: number;
  transitions: number;
  truncated: number;
  graph_path: string;
}

function rowToSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    name: row.name,
    projectName: row.project_name,
    baseUrl: row.base_url,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    role: row.role,
    viewport: row.viewport,
    states: row.states,
    transitions: row.transitions,
    truncated: row.truncated === 1,
  };
}

export async function listRuns(projectRoot: string): Promise<RunSummary[]> {
  await initializeStore(projectRoot);
  const database = openDatabase(projectRoot);
  try {
    const rows = database
      .prepare("SELECT * FROM runs ORDER BY started_at DESC")
      .all() as unknown as RunRow[];
    return rows.map(rowToSummary);
  } finally {
    database.close();
  }
}

async function resolveRunRow(
  projectRoot: string,
  identifier: string,
): Promise<RunRow> {
  await initializeStore(projectRoot);
  const database = openDatabase(projectRoot);
  try {
    const exact = database
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(identifier) as unknown as RunRow | undefined;
    if (exact) return exact;

    const named = database
      .prepare("SELECT * FROM runs WHERE name = ? ORDER BY started_at DESC")
      .all(identifier) as unknown as RunRow[];
    if (named.length === 0) {
      throw new StateScryError(
        "RUN_NOT_FOUND",
        `No behavior run matches “${identifier}”.`,
      );
    }
    return named[0] as RunRow;
  } finally {
    database.close();
  }
}

export async function loadRun(
  projectRoot: string,
  identifier: string,
): Promise<BehaviorRun> {
  const row = await resolveRunRow(projectRoot, identifier);
  return migrateBehaviorRun(JSON.parse(await readFile(row.graph_path, "utf8")));
}

export async function latestRun(
  projectRoot: string,
): Promise<BehaviorRun | null> {
  const runs = await listRuns(projectRoot);
  const first = runs[0];
  return first ? loadRun(projectRoot, first.id) : null;
}

export async function importRun(
  projectRoot: string,
  path: string,
): Promise<RunSummary> {
  const run = migrateBehaviorRun(JSON.parse(await readFile(path, "utf8")));
  run.projectRoot = projectRoot;
  await saveRun(run);
  return summarizeRun(run);
}
