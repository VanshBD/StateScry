import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { errorMessage } from "./errors.js";
import type { CommandHook } from "./types.js";

const execFileAsync = promisify(execFile);

export async function executeCommandHook(
  hook: CommandHook | undefined,
  label: string,
): Promise<void> {
  if (!hook) return;
  await execFileAsync(hook.command, hook.args ?? [], {
    windowsHide: true,
    timeout: hook.timeoutMs ?? 30_000,
  }).catch((error) => {
    throw new Error(`${label} hook failed: ${errorMessage(error)}`);
  });
}
