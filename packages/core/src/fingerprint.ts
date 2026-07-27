import { createHash } from "node:crypto";

import { redactText, redactUrl } from "./redaction.js";
import type { Viewport } from "./types.js";

const VOLATILE_QUERY_KEYS = new Set([
  "_",
  "cache",
  "cacheBust",
  "nonce",
  "timestamp",
  "ts",
]);

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ISO_DATE_PATTERN =
  /\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const LONG_NUMBER_PATTERN = /\b\d{7,}\b/g;
const WHITESPACE_PATTERN = /\s+/g;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(redactUrl(value));
    // Hash routes are application routes in many SPAs, not disposable transport noise.
    // Keep them in the identity after redaction so #/settings and #/billing differ.
    for (const key of [...url.searchParams.keys()]) {
      if (VOLATILE_QUERY_KEYS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return redactUrl(value);
  }
}

export function normalizeSnapshot(
  value: string,
  ignoredPatterns: string[] = [],
): string {
  let normalized = redactText(value)
    .replace(UUID_PATTERN, "[uuid]")
    .replace(ISO_DATE_PATTERN, "[datetime]")
    .replace(LONG_NUMBER_PATTERN, "[number]")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()
    .slice(0, 100_000);
  for (const pattern of ignoredPatterns) {
    try {
      normalized = normalized.replace(new RegExp(pattern, "gi"), "[dynamic]");
    } catch {
      /* ignore malformed optional normalization rule */
    }
  }
  return normalized;
}

interface FingerprintInput {
  url: string;
  title: string;
  heading: string;
  accessibilitySnapshot: string;
  role: string;
  viewport: Viewport;
  featureContext: Record<string, string>;
  ignoredTextPatterns?: string[];
}

export function createFingerprint(input: FingerprintInput): {
  fingerprint: string;
  id: string;
  logicalKey: string;
  normalizedUrl: string;
} {
  const normalizedUrl = normalizeUrl(input.url);
  const snapshot = normalizeSnapshot(
    input.accessibilitySnapshot,
    input.ignoredTextPatterns,
  );
  const context = JSON.stringify(
    Object.entries(input.featureContext).toSorted(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  const fingerprint = sha256(
    [
      normalizedUrl,
      input.title.trim(),
      input.heading.trim(),
      snapshot,
      input.role,
      `${input.viewport.width}x${input.viewport.height}`,
      context,
    ].join("\n"),
  );
  const logicalKey = sha256(
    [
      new URL(normalizedUrl).pathname + new URL(normalizedUrl).hash,
      input.title.trim().toLowerCase(),
      input.heading.trim().toLowerCase(),
      input.role,
      input.viewport.name,
      context,
    ].join("\n"),
  ).slice(0, 20);

  return {
    fingerprint,
    id: `state_${fingerprint.slice(0, 16)}`,
    logicalKey,
    normalizedUrl,
  };
}
