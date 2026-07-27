import { isAbsolute, resolve } from "node:path";
import { Worker } from "node:worker_threads";

import { sanitizeExtensionInput } from "./redaction.js";
import type {
  ExtensionCapability,
  ExtensionInspection,
  ExtensionInvocation,
  ExtensionManifest,
} from "./types.js";
import {
  validateCapabilityResult,
  validateExtensionManifest,
} from "./validation.js";

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const loaded = await import(workerData.moduleUrl);
    const extension = loaded.default ?? loaded.extension ?? loaded;
    const manifest = extension.manifest;
    if (workerData.operation === 'inspect') {
      parentPort.postMessage({ ok: true, manifest, handlers: Object.keys(extension) });
      return;
    }
    const handler = extension[workerData.capability];
    if (typeof handler !== 'function') throw new Error('Declared capability has no handler.');
    const result = await handler(workerData.input);
    parentPort.postMessage({ ok: true, manifest, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
})();
`;

interface WorkerResponse {
  ok: boolean;
  error?: string;
  manifest?: unknown;
  handlers?: string[];
  result?: unknown;
}

function checkedPath(modulePath: string): string {
  const absolute = isAbsolute(modulePath) ? modulePath : resolve(modulePath);
  if (!/\.(?:mjs|js|cjs)$/i.test(absolute))
    throw new Error(
      "Extension module must be a local .js, .mjs, or .cjs file.",
    );
  return absolute;
}

function runWorker(
  modulePath: string,
  data: Record<string, unknown>,
  timeoutMs: number,
): Promise<WorkerResponse> {
  const absolute = checkedPath(modulePath);
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      env: {},
      workerData: {
        moduleUrl: new URL(`file:///${absolute.replaceAll("\\", "/")}`).href,
        ...data,
      },
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new Error(`Extension timed out after ${timeoutMs}ms.`));
      });
    }, timeoutMs);
    worker.once("message", (response: WorkerResponse) =>
      finish(() => {
        void worker.terminate();
        resolveResult(response);
      }),
    );
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code !== 0)
        finish(() =>
          reject(
            new Error(
              `Extension worker exited unexpectedly with code ${code}.`,
            ),
          ),
        );
    });
  });
}

function validateHandlers(
  manifest: ExtensionManifest,
  handlers: string[],
): void {
  for (const capability of manifest.capabilities)
    if (!handlers.includes(capability))
      throw new Error(
        `Extension declares ${capability} but does not export that handler.`,
      );
}

export async function inspectExtension(
  modulePath: string,
): Promise<ExtensionInspection> {
  const absolute = checkedPath(modulePath);
  const response = await runWorker(absolute, { operation: "inspect" }, 5_000);
  if (!response.ok)
    throw new Error(response.error ?? "Extension inspection failed.");
  const manifest = validateExtensionManifest(response.manifest);
  validateHandlers(manifest, response.handlers ?? []);
  return { manifest, modulePath: absolute };
}

export async function invokeExtension<T>(
  modulePath: string,
  capability: ExtensionCapability,
  input: unknown,
  timeoutMs?: number,
): Promise<ExtensionInvocation<T>> {
  const inspected = await inspectExtension(modulePath);
  if (!inspected.manifest.capabilities.includes(capability))
    throw new Error(
      `Extension ${inspected.manifest.name} does not declare ${capability}.`,
    );
  const started = Date.now();
  const limit = timeoutMs ?? inspected.manifest.timeoutMs ?? 2_000;
  const response = await runWorker(
    inspected.modulePath,
    {
      operation: "invoke",
      capability,
      input: sanitizeExtensionInput(input),
    },
    limit,
  );
  if (!response.ok)
    throw new Error(response.error ?? "Extension invocation failed.");
  const manifest = validateExtensionManifest(response.manifest);
  if (
    manifest.name !== inspected.manifest.name ||
    manifest.version !== inspected.manifest.version
  )
    throw new Error(
      "Extension manifest changed between inspection and invocation.",
    );
  const result = validateCapabilityResult(capability, response.result) as T;
  const serialized = JSON.stringify(result);
  if (serialized.length > 1_000_000)
    throw new Error("Extension result exceeds the 1 MB boundary.");
  return {
    extension: `${manifest.name}@${manifest.version}`,
    capability,
    durationMs: Date.now() - started,
    result,
  };
}
