import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { exploreApplication } from "./explorer.js";
import { sha256 } from "./fingerprint.js";
import { executeCommandHook } from "./hooks.js";
import { loadRun } from "./store.js";
import type {
  BehaviorRun,
  ExploreOptions,
  StateNode,
  Transition,
} from "./types.js";

export interface MatrixCell {
  key: string;
  options: ExploreOptions;
}

export interface MatrixCheckpointCell {
  key: string;
  status: "complete" | "failed";
  runId?: string;
  error?: string;
}

export interface MatrixCheckpoint {
  schemaVersion: 1;
  sessionId: string;
  inputHash: string;
  updatedAt: string;
  cells: MatrixCheckpointCell[];
}

export interface BehaviorAtlas {
  schemaVersion: 1;
  nodes: Array<{ id: string; cell: string; state: StateNode }>;
  edges: Array<{ id: string; cell: string; transition: Transition }>;
}

export interface MappingMatrixResult {
  schemaVersion: 1;
  sessionId: string;
  checkpointPath: string;
  runs: Array<{ key: string; run: BehaviorRun }>;
  atlas: BehaviorAtlas;
  resumedCells: string[];
  executedCells: string[];
  maxWorkers: number;
  sharedSeedHookRuns: number;
}

export interface MappingMatrixOptions {
  projectRoot: string;
  maxWorkers?: number;
  checkpointPath?: string;
  resume?: boolean;
  runner?: (options: ExploreOptions) => Promise<BehaviorRun>;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "priorRun")
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stable(entry)]),
  );
}

function inputIdentity(cells: MatrixCell[]): string {
  return sha256(
    JSON.stringify(
      cells
        .map((cell) => ({ key: cell.key, options: stable(cell.options) }))
        .toSorted((a, b) => a.key.localeCompare(b.key)),
    ),
  );
}

async function readCheckpoint(
  path: string,
  inputHash: string,
): Promise<MatrixCheckpoint | null> {
  try {
    const checkpoint = JSON.parse(
      await readFile(path, "utf8"),
    ) as MatrixCheckpoint;
    if (
      checkpoint.schemaVersion !== 1 ||
      checkpoint.inputHash !== inputHash ||
      !Array.isArray(checkpoint.cells)
    )
      throw new Error(
        "Matrix checkpoint does not match the current versioned input.",
      );
    return checkpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeCheckpoint(
  path: string,
  checkpoint: MatrixCheckpoint,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function sameSeedHook(cells: MatrixCell[]): ExploreOptions["seedHook"] {
  const hooks = cells.map((cell) =>
    cell.options.allowHooks ? cell.options.seedHook : undefined,
  );
  const first = JSON.stringify(hooks[0]);
  if (!hooks[0] || hooks.some((hook) => JSON.stringify(hook) !== first))
    return undefined;
  return hooks[0];
}

function atlas(runs: Array<{ key: string; run: BehaviorRun }>): BehaviorAtlas {
  return {
    schemaVersion: 1,
    nodes: runs
      .flatMap(({ key, run }) =>
        run.states.map((state) => ({
          id: `${key}:${state.id}`,
          cell: key,
          state,
        })),
      )
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    edges: runs
      .flatMap(({ key, run }) =>
        run.transitions.map((transition) => ({
          id: `${key}:${transition.id}`,
          cell: key,
          transition,
        })),
      )
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function runMappingMatrix(
  inputCells: MatrixCell[],
  options: MappingMatrixOptions,
): Promise<MappingMatrixResult> {
  if (inputCells.length === 0)
    throw new Error("Matrix needs at least one cell.");
  const cells = [...inputCells].toSorted((a, b) => a.key.localeCompare(b.key));
  if (new Set(cells.map((cell) => cell.key)).size !== cells.length)
    throw new Error("Matrix cell keys must be unique.");
  if (
    cells.some(
      (cell) =>
        resolve(cell.options.projectRoot) !== resolve(options.projectRoot),
    )
  )
    throw new Error("Every matrix cell must use the declared project root.");
  const inputHash = inputIdentity(cells);
  const sessionId = `matrix_${inputHash.slice(0, 16)}`;
  const checkpointPath = resolve(
    options.checkpointPath ??
      resolve(
        options.projectRoot,
        ".statescry",
        "sessions",
        `${sessionId}.json`,
      ),
  );
  const previous = options.resume
    ? await readCheckpoint(checkpointPath, inputHash)
    : null;
  const completed = new Map(
    (previous?.cells ?? [])
      .filter((cell) => cell.status === "complete" && cell.runId)
      .map((cell) => [cell.key, cell.runId!] as const),
  );
  const runs = new Map<string, BehaviorRun>();
  const resumedCells: string[] = [];
  for (const [key, runId] of completed) {
    runs.set(key, await loadRun(options.projectRoot, runId));
    resumedCells.push(key);
  }

  const seedHook = sameSeedHook(cells);
  let sharedSeedHookRuns = 0;
  if (seedHook && cells.some((cell) => !completed.has(cell.key))) {
    await executeCommandHook(seedHook, "Shared matrix seed");
    sharedSeedHookRuns = 1;
  }
  const runner = options.runner ?? exploreApplication;
  const pending = cells.filter((cell) => !completed.has(cell.key));
  const executedCells: string[] = [];
  const failures: MatrixCheckpointCell[] = [];
  const maxWorkers = Math.max(
    1,
    Math.min(Math.floor(options.maxWorkers ?? 2), pending.length || 1),
  );
  let cursor = 0;
  let checkpointWrite: Promise<void> = Promise.resolve();

  const persist = async (): Promise<void> => {
    const checkpointCells: MatrixCheckpointCell[] = [
      ...[...runs.entries()].map(([key, run]) => ({
        key,
        status: "complete" as const,
        runId: run.id,
      })),
      ...failures,
    ].toSorted((a, b) => a.key.localeCompare(b.key));
    const snapshot: MatrixCheckpoint = {
      schemaVersion: 1,
      sessionId,
      inputHash,
      updatedAt: new Date().toISOString(),
      cells: checkpointCells,
    };
    checkpointWrite = checkpointWrite.then(() =>
      writeCheckpoint(checkpointPath, snapshot),
    );
    await checkpointWrite;
  };

  await Promise.all(
    Array.from({ length: maxWorkers }, async () => {
      while (cursor < pending.length) {
        const cell = pending[cursor++];
        if (!cell) break;
        const cellOptions: ExploreOptions = (() => {
          if (!seedHook) return cell.options;
          const { seedHook: _sharedSeedHook, ...withoutSeedHook } =
            cell.options;
          return withoutSeedHook;
        })();
        try {
          const run = await runner(cellOptions);
          runs.set(cell.key, run);
          executedCells.push(cell.key);
          await persist();
        } catch (error) {
          failures.push({
            key: cell.key,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
          await persist();
        }
      }
    }),
  );

  if (failures.length > 0)
    throw new Error(
      `Matrix incomplete: ${failures.map((failure) => `${failure.key}: ${failure.error}`).join("; ")}`,
    );
  const orderedRuns = [...runs.entries()]
    .map(([key, run]) => ({ key, run }))
    .toSorted((a, b) => a.key.localeCompare(b.key));
  return {
    schemaVersion: 1,
    sessionId,
    checkpointPath,
    runs: orderedRuns,
    atlas: atlas(orderedRuns),
    resumedCells: resumedCells.sort(),
    executedCells: executedCells.sort(),
    maxWorkers,
    sharedSeedHookRuns,
  };
}
