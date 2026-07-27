const SECRET_KEY =
  /(authorization|cookie|password|passwd|secret|token|api[-_]?key)/i;
const SECRET_VALUE = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|pk|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
];

function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_VALUE)
    result = result.replace(pattern, "[REDACTED]");
  return result.slice(0, 100_000);
}

export function sanitizeExtensionInput(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value))
    return value.slice(0, 1_000).map(sanitizeExtensionInput);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 1_000)
      .map(([key, entry]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeExtensionInput(entry),
      ]),
  );
}
