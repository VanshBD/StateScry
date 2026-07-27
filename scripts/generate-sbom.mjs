import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
const packageBlock = lock.split(/^snapshots:\s*$/m)[0] ?? lock;
const components = [];
const seen = new Set();

for (const line of packageBlock.split(/\r?\n/)) {
  const match = line.match(/^  (['"]?)(.+?)\1:\s*$/);
  if (!match?.[2] || match[2] === "packages" || match[2].startsWith("/"))
    continue;
  let key = match[2].replace(/\(.+\)$/, "");
  const separator = key.lastIndexOf("@");
  if (separator <= 0) continue;
  const name = key.slice(0, separator);
  const version = key.slice(separator + 1);
  if (!version || version.includes(":")) continue;
  const identity = `${name}@${version}`;
  if (seen.has(identity)) continue;
  seen.add(identity);
  components.push({
    type: "library",
    name,
    version,
    purl: `pkg:npm/${encodeURIComponent(name).replace("%40", "@")}@${encodeURIComponent(version)}`,
  });
}

for (const path of [
  "packages/sdk/package.json",
  "packages/core/package.json",
  "packages/mcp/package.json",
  "packages/cli/package.json",
]) {
  const manifest = JSON.parse(await readFile(resolve(root, path), "utf8"));
  components.push({
    type: "application",
    name: manifest.name,
    version: manifest.version,
    purl: `pkg:npm/${encodeURIComponent(manifest.name).replace("%40", "@")}@${manifest.version}`,
  });
}

components.sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
const serial = createHash("sha256")
  .update(JSON.stringify(components))
  .digest("hex")
  .slice(0, 32);
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${serial.slice(0, 8)}-${serial.slice(8, 12)}-4${serial.slice(13, 16)}-8${serial.slice(17, 20)}-${serial.slice(20)}`,
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "statescry",
      version: "2.0.0",
    },
    tools: [
      {
        vendor: "StateScry contributors",
        name: "generate-sbom.mjs",
        version: "1",
      },
    ],
  },
  components,
};

const output = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, ".statescry", "release", "statescry-2.0.0.cdx.json");
await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
process.stdout.write(`${output}\n`);
