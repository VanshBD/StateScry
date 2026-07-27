import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = resolve(root, ".statescry", "release");
const packageRoot = resolve(releaseRoot, "packages");
if (!releaseRoot.startsWith(`${resolve(root, ".statescry")}${sep}`))
  throw new Error("Release output escaped .statescry.");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli)
  throw new Error(
    "release:build must run through the declared package manager.",
  );
function run(args) {
  const result = spawnSync(process.execPath, [packageManagerCli, ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      `pnpm ${args.join(" ")} failed with ${result.status}: ${result.error?.message ?? "no process status"}.`,
    );
}

run(["build"]);
for (const name of [
  "@statescry-tool/sdk",
  "@statescry-tool/core",
  "@statescry-tool/mcp",
  "@statescry-tool/cli",
])
  run(["--filter", name, "pack", "--pack-destination", packageRoot]);

const archives = (await readdir(packageRoot))
  .filter((name) => name.endsWith(".tgz"))
  .sort();
if (archives.length !== 4)
  throw new Error(`Expected four package archives, found ${archives.length}.`);

const artifacts = [];
for (const name of archives) {
  const path = resolve(packageRoot, name);
  const bytes = await readFile(path);
  artifacts.push({
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  resolve(releaseRoot, "checksums.json"),
  `${JSON.stringify({ schemaVersion: 1, version: "2.0.0", artifacts }, null, 2)}\n`,
  "utf8",
);

const node = process.execPath;
const sbom = spawnSync(
  node,
  [
    resolve(root, "scripts", "generate-sbom.mjs"),
    resolve(releaseRoot, "statescry-2.0.0.cdx.json"),
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (sbom.status !== 0) throw new Error("SBOM generation failed.");

const provenance = {
  _type: "https://in-toto.io/Statement/v1",
  subject: artifacts.map((artifact) => ({
    name: artifact.name,
    digest: { sha256: artifact.sha256 },
  })),
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://statescry.dev/local-release/v1",
      externalParameters: { version: "2.0.0" },
      resolvedDependencies: [],
    },
    runDetails: {
      builder: { id: "local:statescry-build-release" },
      metadata: {
        invocationId: createHash("sha256")
          .update(JSON.stringify(artifacts))
          .digest("hex"),
      },
    },
  },
};
await writeFile(
  resolve(releaseRoot, "provenance.intoto.jsonl"),
  `${JSON.stringify(provenance)}\n`,
  "utf8",
);
process.stdout.write(
  `Prepared ${artifacts.length} package artifacts in ${releaseRoot}\n`,
);
