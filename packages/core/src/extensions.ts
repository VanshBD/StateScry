import {
  inspectExtension,
  invokeExtension,
  type ExtensionAction,
  type ExtensionInspection,
  type ExtensionPageSnapshot,
  type ExtensionRedactorResult,
} from "@statescry/sdk";

import { sha256 } from "./fingerprint.js";
import type { ActionDescriptor, StateNode } from "./types.js";

export interface ExtensionRuntime {
  inspections: ExtensionInspection[];
  warnings: string[];
  redact: (label: string, text: string) => Promise<string>;
  actions: (snapshot: ExtensionPageSnapshot) => Promise<ActionDescriptor[]>;
}

function extensionAction(
  extension: string,
  action: ExtensionAction,
): ActionDescriptor {
  return {
    id: `extension_${sha256(`${extension}\n${action.name}\n${action.kind}\n${action.selector ?? action.key ?? ""}`).slice(0, 16)}`,
    kind: action.kind,
    selector: action.selector ?? "body",
    label: action.label ?? action.name,
    tag: `extension:${extension}`,
    ...(action.key ? { key: action.key } : {}),
    ...(action.value !== undefined ? { value: action.value } : {}),
    risk: action.allowInObserveMode ? "safe" : "review",
    configured: true,
    ...(action.secretValue ? { secretValue: true } : {}),
  };
}

export function extensionSnapshot(state: StateNode): ExtensionPageSnapshot {
  return {
    url: state.url,
    title: state.title,
    heading: state.heading,
    textSample: state.textSample,
    role: state.role,
    viewport: state.viewport,
    featureContext: state.featureContext,
  };
}

export async function prepareExtensionRuntime(
  modulePaths: string[] = [],
  enabled = false,
): Promise<ExtensionRuntime> {
  const warnings: string[] = [];
  if (!enabled && modulePaths.length > 0)
    warnings.push(
      "Configured extensions were not loaded because explicit extension enablement was not supplied.",
    );
  const inspections = enabled
    ? await Promise.all(modulePaths.map((path) => inspectExtension(path)))
    : [];
  return {
    inspections,
    warnings,
    async redact(label, text) {
      let redacted = text;
      for (const inspection of inspections) {
        if (!inspection.manifest.capabilities.includes("redactors")) continue;
        try {
          const invocation = await invokeExtension<ExtensionRedactorResult>(
            inspection.modulePath,
            "redactors",
            { label, text: redacted },
          );
          redacted = invocation.result.text;
        } catch (error) {
          warnings.push(
            `${inspection.manifest.name} redactor failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return redacted;
    },
    async actions(snapshot) {
      const actions: ActionDescriptor[] = [];
      for (const inspection of inspections) {
        if (!inspection.manifest.capabilities.includes("actions")) continue;
        try {
          const invocation = await invokeExtension<ExtensionAction[]>(
            inspection.modulePath,
            "actions",
            snapshot,
          );
          actions.push(
            ...invocation.result.map((action) =>
              extensionAction(inspection.manifest.name, action),
            ),
          );
        } catch (error) {
          warnings.push(
            `${inspection.manifest.name} actions failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return actions;
    },
  };
}
