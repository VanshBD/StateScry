const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[REDACTED_SECRET]"],
  [
    /(["']?(?:password|passwd|token|secret|api[_-]?key|authorization)["']?\s*[:=]\s*)["']?[^"',\s}]+["']?/gi,
    "$1[REDACTED]",
  ],
];

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "code",
]);

export function redactText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return redactText(value);
  }
}

export function redactRecord(
  record: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      /token|secret|password|key|authorization/i.test(key)
        ? "[REDACTED]"
        : redactText(value),
    ]),
  );
}
