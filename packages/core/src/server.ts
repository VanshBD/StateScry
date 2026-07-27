import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";

import { analyzeRun, compareRoleAccess } from "./analysis.js";
import { compareRuns } from "./diff.js";
import { errorMessage } from "./errors.js";
import { calculateCoverageHistory } from "./history.js";
import { replayState } from "./replay.js";
import { latestRun, listRuns, loadRun, runDirectory } from "./store.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".yaml": "text/yaml; charset=utf-8",
  ".zip": "application/zip",
};

function dashboardRun(run: Awaited<ReturnType<typeof loadRun>>) {
  const { storageStatePath: _privateStorageStatePath, ...persona } =
    run.persona;
  return { ...run, projectRoot: "[local project]", persona };
}

function json(
  response: import("node:http").ServerResponse,
  value: unknown,
  status = 200,
) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function within(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  );
}

async function serveFile(
  response: import("node:http").ServerResponse,
  root: string,
  requestPath: string,
): Promise<boolean> {
  const candidate = resolve(root, requestPath.replace(/^[/\\]+/, ""));
  if (!within(root, candidate)) return false;
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[extname(candidate)] ?? "application/octet-stream",
      "cache-control":
        extname(candidate) === ".html" ? "no-store" : "public, max-age=3600",
    });
    createReadStream(candidate).pipe(response);
    return true;
  } catch {
    return false;
  }
}

export interface DashboardServerOptions {
  projectRoot: string;
  publicDirectory: string;
  port?: number;
  host?: string;
}

export interface DashboardServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    try {
      if (requestUrl.pathname === "/api/health") {
        json(response, { ok: true, product: "StateScry", version: "2.0.0" });
        return;
      }
      if (requestUrl.pathname === "/api/runs") {
        json(response, await listRuns(options.projectRoot));
        return;
      }
      if (requestUrl.pathname === "/api/history") {
        const summaries = await listRuns(options.projectRoot);
        const runs = await Promise.all(
          summaries.map((summary) => loadRun(options.projectRoot, summary.id)),
        );
        json(response, calculateCoverageHistory(runs));
        return;
      }
      if (requestUrl.pathname === "/api/runs/latest") {
        const run = await latestRun(options.projectRoot);
        json(response, run ? dashboardRun(run) : null);
        return;
      }
      if (requestUrl.pathname === "/api/diff") {
        const before = requestUrl.searchParams.get("before");
        const after = requestUrl.searchParams.get("after");
        if (!before || !after) {
          json(
            response,
            { error: "before and after run identifiers are required" },
            400,
          );
          return;
        }
        json(
          response,
          compareRuns(
            await loadRun(options.projectRoot, before),
            await loadRun(options.projectRoot, after),
          ),
        );
        return;
      }
      if (requestUrl.pathname === "/api/access") {
        const less = requestUrl.searchParams.get("less");
        const privileged = requestUrl.searchParams.get("privileged");
        if (!less || !privileged) {
          json(
            response,
            { error: "less and privileged run identifiers are required" },
            400,
          );
          return;
        }
        json(
          response,
          compareRoleAccess(
            await loadRun(options.projectRoot, less),
            await loadRun(options.projectRoot, privileged),
          ),
        );
        return;
      }
      if (requestUrl.pathname === "/api/replay") {
        if (request.method !== "POST") {
          json(response, { error: "Replay requires POST." }, 405);
          return;
        }
        const runId = requestUrl.searchParams.get("run");
        const stateId = requestUrl.searchParams.get("state");
        if (!runId || !stateId) {
          json(
            response,
            { error: "run and state identifiers are required" },
            400,
          );
          return;
        }
        json(
          response,
          await replayState(await loadRun(options.projectRoot, runId), stateId),
        );
        return;
      }
      const analysisMatch = requestUrl.pathname.match(
        /^\/api\/runs\/([^/]+)\/analysis$/,
      );
      if (analysisMatch?.[1]) {
        json(
          response,
          analyzeRun(
            await loadRun(
              options.projectRoot,
              decodeURIComponent(analysisMatch[1]),
            ),
          ),
        );
        return;
      }
      const runMatch = requestUrl.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch?.[1]) {
        json(
          response,
          dashboardRun(
            await loadRun(options.projectRoot, decodeURIComponent(runMatch[1])),
          ),
        );
        return;
      }
      const artifactMatch = requestUrl.pathname.match(
        /^\/api\/artifacts\/([^/]+)\/(.+)$/,
      );
      if (artifactMatch?.[1] && artifactMatch[2]) {
        const root = runDirectory(
          options.projectRoot,
          decodeURIComponent(artifactMatch[1]),
        );
        if (
          await serveFile(response, root, decodeURIComponent(artifactMatch[2]))
        ) {
          return;
        }
        json(response, { error: "Artifact not found" }, 404);
        return;
      }

      const assetPath =
        requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname;
      if (await serveFile(response, options.publicDirectory, assetPath)) {
        return;
      }
      const index = resolve(options.publicDirectory, "index.html");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(await readFile(index));
    } catch (error) {
      json(response, { error: errorMessage(error) }, 500);
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4317, host, () => resolveListen());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : (options.port ?? 4317);

  return {
    server,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}
