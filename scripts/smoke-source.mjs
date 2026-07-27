import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const consumer = resolve(root, ".statescry", "quality", "source-consumer");
if (!consumer.startsWith(`${resolve(root, ".statescry", "quality")}${sep}`))
  throw new Error("Source consumer escaped the quality directory.");
await rm(consumer, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
const skipped = new Set(["node_modules", "dist", ".statescry", ".git"]);
for (const entry of await readdir(root)) {
  if (skipped.has(entry)) continue;
  await cp(resolve(root, entry), resolve(consumer, entry), {
    recursive: true,
    filter: (source) => !skipped.has(basename(source)),
  });
}

const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli)
  throw new Error("release:source-smoke must run through the package manager.");
function pnpm(args, options = {}) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...args], {
    cwd: consumer,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `Clean-source pnpm ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  return result;
}
pnpm(["install", "--frozen-lockfile", "--offline"]);
pnpm(["build"]);

const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const value = typeof address === "object" && address ? address.port : 0;
    probe.close((error) => (error ? reject(error) : resolvePort(value)));
  });
});
const vite = resolve(
  consumer,
  "examples",
  "demo-app",
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);
const demo = spawn(
  process.execPath,
  [vite, "preview", "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: resolve(consumer, "examples", "demo-app"),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
const url = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    const response = await fetch(url);
    if (response.ok) break;
  } catch {
    // The production preview is still starting.
  }
  if (attempt === 79) throw new Error("Clean-source demo did not start.");
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}

const cli = resolve(consumer, "packages", "cli", "dist", "bin.js");
const project = resolve(consumer, ".clean-project");
await mkdir(project, { recursive: true });
function cliRun(args) {
  const result = spawnSync(
    process.execPath,
    [cli, "--root", project, "--json", ...args],
    { cwd: consumer, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(
      `Clean-source CLI ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  return result.stdout;
}

try {
  cliRun(["init", url]);
  const baseline = JSON.parse(
    cliRun([
      "map",
      url,
      "--name",
      "clean-baseline",
      "--max-states",
      "6",
      "--max-depth",
      "3",
    ]),
  );
  const replayTarget = baseline.states.at(-1);
  if (!replayTarget) throw new Error("Clean-source map found no state.");
  const replay = JSON.parse(cliRun(["replay", baseline.id, replayTarget.id]));
  if (replay.status !== "verified")
    throw new Error("Clean-source replay was not verified.");
  const candidate = JSON.parse(
    cliRun([
      "map",
      url,
      "--name",
      "clean-candidate",
      "--max-states",
      "6",
      "--max-depth",
      "3",
    ]),
  );
  cliRun(["report", baseline.id, candidate.id, "--output", "behavior.md"]);

  const mcp = resolve(consumer, "packages", "mcp", "dist", "bin.js");
  const child = spawn(process.execPath, [mcp], {
    cwd: project,
    env: { ...process.env, STATESCRY_PROJECT_ROOT: project },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const handshake = await new Promise((resolveResponse, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Source MCP timed out.")),
      8_000,
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      resolveResponse(JSON.parse(line));
    });
    child.once("error", reject);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "source-smoke", version: "1.0.0" } } })}\n`,
    );
  });
  child.kill();
  if (handshake?.result?.serverInfo?.version !== "2.0.0")
    throw new Error("Clean-source MCP handshake failed.");

  await writeFile(
    resolve(root, ".statescry", "quality", "source-clean-room.json"),
    `${JSON.stringify(
      {
        status: "passed",
        version: "2.0.0",
        install: "frozen lockfile, offline store",
        build: true,
        map: {
          states: baseline.states.length,
          transitions: baseline.transitions.length,
        },
        replay: replay.status,
        report: true,
        mcpHandshake: true,
        requiredCredentials: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
} finally {
  demo.kill();
}
process.stdout.write("Clean-source repository smoke passed.\n");
