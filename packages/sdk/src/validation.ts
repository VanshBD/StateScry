import {
  STATESCRY_EXTENSION_API_VERSION,
  type ExtensionAction,
  type ExtensionCapability,
  type ExtensionManifest,
} from "./types.js";

const CAPABILITIES: ExtensionCapability[] = [
  "actions",
  "assertions",
  "redactors",
  "matchers",
];

export function validateExtensionManifest(value: unknown): ExtensionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Extension manifest must be an object.");
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1)
    throw new Error("Extension manifest schemaVersion must be 1.");
  if (manifest.apiVersion !== STATESCRY_EXTENSION_API_VERSION)
    throw new Error(
      `Extension apiVersion ${String(manifest.apiVersion)} is incompatible; host supports ${STATESCRY_EXTENSION_API_VERSION}.`,
    );
  if (typeof manifest.name !== "string" || !manifest.name.trim())
    throw new Error("Extension manifest requires a non-empty name.");
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
  )
    throw new Error(
      "Extension manifest version must be semantic version text.",
    );
  if (
    !Array.isArray(manifest.capabilities) ||
    manifest.capabilities.length === 0 ||
    manifest.capabilities.some(
      (capability) => !CAPABILITIES.includes(capability as ExtensionCapability),
    )
  )
    throw new Error(
      `Extension capabilities must contain one or more of: ${CAPABILITIES.join(", ")}.`,
    );
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length)
    throw new Error("Extension capabilities must be unique.");
  if (
    manifest.timeoutMs !== undefined &&
    (typeof manifest.timeoutMs !== "number" ||
      !Number.isInteger(manifest.timeoutMs) ||
      manifest.timeoutMs < 10 ||
      manifest.timeoutMs > 30_000)
  )
    throw new Error("Extension timeoutMs must be an integer from 10 to 30000.");
  return manifest as unknown as ExtensionManifest;
}

export function validateExtensionActions(value: unknown): ExtensionAction[] {
  if (!Array.isArray(value))
    throw new Error("Extension actions must be an array.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`Extension action ${index} must be an object.`);
    const action = entry as Record<string, unknown>;
    if (typeof action.name !== "string" || !action.name.trim())
      throw new Error(`Extension action ${index} requires a name.`);
    if (
      !(["click", "fill", "press", "select", "check"] as const).includes(
        action.kind as never,
      )
    )
      throw new Error(`Extension action ${index} has an unsupported kind.`);
    if (action.kind === "press") {
      if (typeof action.key !== "string" || !action.key)
        throw new Error(`Extension press action ${index} requires a key.`);
    } else if (typeof action.selector !== "string" || !action.selector) {
      throw new Error(`Extension action ${index} requires a selector.`);
    }
    for (const key of ["value", "label"])
      if (action[key] !== undefined && typeof action[key] !== "string")
        throw new Error(`Extension action ${index} ${key} must be text.`);
    for (const key of ["secretValue", "allowInObserveMode"])
      if (action[key] !== undefined && typeof action[key] !== "boolean")
        throw new Error(`Extension action ${index} ${key} must be boolean.`);
    return action as unknown as ExtensionAction;
  });
}

export function validateCapabilityResult(
  capability: ExtensionCapability,
  value: unknown,
): unknown {
  if (capability === "actions") return validateExtensionActions(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Extension ${capability} result must be an object.`);
  const result = value as Record<string, unknown>;
  if (capability === "assertions") {
    if (
      typeof result.passed !== "boolean" ||
      typeof result.actual !== "string" ||
      typeof result.explanation !== "string"
    )
      throw new Error(
        "Extension assertion result requires passed, actual, and explanation.",
      );
  } else if (capability === "redactors") {
    if (typeof result.text !== "string")
      throw new Error("Extension redactor result requires text.");
  } else if (
    typeof result.score !== "number" ||
    !Number.isFinite(result.score) ||
    result.score < 0 ||
    result.score > 1 ||
    typeof result.explanation !== "string"
  ) {
    throw new Error(
      "Extension matcher result requires a 0..1 score and explanation.",
    );
  }
  return value;
}
