import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = resolve(root, ".statescry", "release");
const packageRoot = resolve(releaseRoot, "packages");
const consumer = resolve(root, ".statescry", "quality", "package-consumer");
if (!consumer.startsWith(`${resolve(root, ".statescry", "quality")}${sep}`))
  throw new Error("Consumer output escaped the quality directory.");
await rm(consumer, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
await writeFile(
  resolve(consumer, "package.json"),
  `${JSON.stringify({ name: "statescry-clean-room", version: "1.0.0", private: true, type: "module" }, null, 2)}\n`,
  "utf8",
);
const archives = (await readdir(packageRoot))
  .filter((name) => name.endsWith(".tgz"))
  .map((name) => resolve(packageRoot, name));
if (archives.length !== 4) throw new Error("Build release artifacts first.");
const tarball = (fragment) => {
  const path = archives.find((archive) => archive.includes(fragment));
  if (!path) throw new Error(`Missing ${fragment} release archive.`);
  return `file:${path.replaceAll("\\", "/")}`;
};
await writeFile(
  resolve(consumer, "package.json"),
  `${JSON.stringify(
    {
      name: "statescry-clean-room",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@statescry-tool/sdk": tarball("statescry-tool-sdk-"),
        "@statescry-tool/core": tarball("statescry-tool-core-"),
        "@statescry-tool/mcp": tarball("statescry-tool-mcp-"),
        "@statescry-tool/cli": tarball("statescry-tool-cli-"),
      },
      pnpm: {
        overrides: {
          "@statescry-tool/sdk": tarball("statescry-tool-sdk-"),
          "@statescry-tool/core": tarball("statescry-tool-core-"),
          "@statescry-tool/mcp": tarball("statescry-tool-mcp-"),
          "@statescry-tool/cli": tarball("statescry-tool-cli-"),
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli)
  throw new Error(
    "release:smoke must run through the declared package manager.",
  );
const install = spawnSync(
  process.execPath,
  [packageManagerCli, "install", "--ignore-scripts", "--ignore-workspace"],
  {
    cwd: consumer,
    stdio: "inherit",
    windowsHide: true,
  },
);
if (install.status !== 0)
  throw new Error("Clean-room package installation failed.");

for (const name of ["sdk", "core", "mcp", "cli"]) {
  const manifestPath = resolve(
    consumer,
    "node_modules",
    "@statescry-tool",
    name,
    "package.json",
  );
  const text = await readFile(manifestPath, "utf8");
  if (text.includes("workspace:"))
    throw new Error(`${name} package retained a workspace dependency.`);
}
const sdk = await import(
  new URL(
    "./node_modules/@statescry-tool/sdk/dist/index.js",
    `file:///${consumer.replaceAll("\\", "/")}/`,
  ).href
);
const core = await import(
  new URL(
    "./node_modules/@statescry-tool/core/dist/index.js",
    `file:///${consumer.replaceAll("\\", "/")}/`,
  ).href
);
if (sdk.STATESCRY_EXTENSION_API_VERSION !== 1)
  throw new Error("SDK import smoke failed.");
if (core.STATESCRY_SCHEMA_VERSION !== 3)
  throw new Error("Core import smoke failed.");

const cli = resolve(
  consumer,
  "node_modules",
  "@statescry-tool",
  "cli",
  "dist",
  "bin.js",
);
const version = spawnSync(process.execPath, [cli, "--version"], {
  cwd: consumer,
  encoding: "utf8",
  windowsHide: true,
});
if (version.status !== 0 || !version.stdout.trim().startsWith("2."))
  throw new Error(`CLI smoke failed: ${version.stderr}`);
const project = resolve(consumer, "project");
await mkdir(project, { recursive: true });
const init = spawnSync(
  process.execPath,
  [cli, "--root", project, "--json", "init", "http://127.0.0.1:3000"],
  { cwd: consumer, encoding: "utf8", windowsHide: true },
);
if (init.status !== 0) throw new Error(`CLI init smoke failed: ${init.stderr}`);

const mcp = resolve(
  consumer,
  "node_modules",
  "@statescry-tool",
  "mcp",
  "dist",
  "bin.js",
);
const child = spawn(process.execPath, [mcp], {
  cwd: project,
  env: { ...process.env, STATESCRY_PROJECT_ROOT: project },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const response = await new Promise((resolveResponse, reject) => {
  const timer = setTimeout(
    () => reject(new Error("MCP handshake timed out.")),
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
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "clean-room", version: "1.0.0" } } })}\n`,
  );
});
child.kill();
if (response?.result?.serverInfo?.version !== "2.0.0")
  throw new Error("MCP package handshake returned an unexpected version.");

const record = {
  status: "passed",
  version: "2.0.0",
  packages: ["sdk", "core", "mcp", "cli"],
  workspaceReferences: 0,
  cliVersion: version.stdout.trim(),
  cliInit: true,
  coreImport: true,
  sdkImport: true,
  mcpHandshake: true,
};
await writeFile(
  resolve(root, ".statescry", "quality", "package-clean-room.json"),
  `${JSON.stringify(record, null, 2)}\n`,
  "utf8",
);
process.stdout.write("Clean-room package smoke passed.\n");
