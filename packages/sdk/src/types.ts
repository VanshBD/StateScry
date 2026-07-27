export const STATESCRY_EXTENSION_API_VERSION = 1 as const;

export type ExtensionCapability =
  "actions" | "assertions" | "redactors" | "matchers";

export interface ExtensionManifest {
  schemaVersion: 1;
  apiVersion: 1;
  name: string;
  version: string;
  description?: string;
  capabilities: ExtensionCapability[];
  timeoutMs?: number;
}

export interface ExtensionPageSnapshot {
  url: string;
  title: string;
  heading: string;
  textSample: string;
  role: string;
  viewport: { name: string; width: number; height: number };
  featureContext: Record<string, string>;
}

export interface ExtensionAction {
  name: string;
  kind: "click" | "fill" | "press" | "select" | "check";
  selector?: string;
  key?: string;
  value?: string;
  label?: string;
  secretValue?: boolean;
  allowInObserveMode?: boolean;
}

export interface ExtensionAssertionInput {
  name: string;
  expected: string;
  snapshot: ExtensionPageSnapshot;
}

export interface ExtensionAssertionResult {
  passed: boolean;
  actual: string;
  explanation: string;
}

export interface ExtensionRedactorInput {
  label: string;
  text: string;
}

export interface ExtensionRedactorResult {
  text: string;
}

export interface ExtensionMatcherInput {
  before: ExtensionPageSnapshot;
  after: ExtensionPageSnapshot;
}

export interface ExtensionMatcherResult {
  score: number;
  explanation: string;
}

export interface StateScryExtension {
  manifest: ExtensionManifest;
  actions?: (
    snapshot: ExtensionPageSnapshot,
  ) => ExtensionAction[] | Promise<ExtensionAction[]>;
  assertions?: (
    input: ExtensionAssertionInput,
  ) => ExtensionAssertionResult | Promise<ExtensionAssertionResult>;
  redactors?: (
    input: ExtensionRedactorInput,
  ) => ExtensionRedactorResult | Promise<ExtensionRedactorResult>;
  matchers?: (
    input: ExtensionMatcherInput,
  ) => ExtensionMatcherResult | Promise<ExtensionMatcherResult>;
}

export interface ExtensionInspection {
  manifest: ExtensionManifest;
  modulePath: string;
}

export interface ExtensionInvocation<T> {
  extension: string;
  capability: ExtensionCapability;
  durationMs: number;
  result: T;
}
