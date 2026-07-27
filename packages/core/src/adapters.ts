import type { Page } from "playwright";

import type { FrameworkAdapterConfig } from "./types.js";

export interface FrameworkSignalCollection {
  signals: Record<string, string>;
  warnings: string[];
  applied: string[];
}

function adapterKey(config: FrameworkAdapterConfig): string {
  return `${config.name}@${config.version}`;
}

export function validateFrameworkAdapters(
  configs: FrameworkAdapterConfig[],
): void {
  const seen = new Set<string>();
  for (const config of configs) {
    if (!config || typeof config !== "object")
      throw new Error("Framework adapters must be objects.");
    if (!(["dom-markers", "next-data"] as const).includes(config.name))
      throw new Error(`Unsupported framework adapter: ${String(config.name)}.`);
    if (config.version !== 1)
      throw new Error(
        `Framework adapter ${config.name} supports version 1, received ${String(config.version)}.`,
      );
    const key = adapterKey(config);
    if (seen.has(key)) throw new Error(`Duplicate framework adapter: ${key}.`);
    seen.add(key);
  }
}

export async function collectFrameworkSignals(
  page: Page,
  configs: FrameworkAdapterConfig[] = [],
): Promise<FrameworkSignalCollection> {
  validateFrameworkAdapters(configs);
  const signals: Record<string, string> = {};
  const warnings: string[] = [];
  const applied: string[] = [];

  for (const config of configs) {
    const key = adapterKey(config);
    if (config.name === "dom-markers") {
      const marker = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>(
          "[data-statescry-state]",
        );
        const meta = document.querySelector<HTMLMetaElement>(
          'meta[name="statescry-state"]',
        );
        return element?.dataset.statescryState ?? meta?.content ?? "";
      });
      if (marker) {
        signals["dom.state"] = marker.slice(0, 500);
        applied.push(key);
      } else {
        warnings.push(
          `${key} found no explicit state marker; black-box signals remain active.`,
        );
      }
    } else if (config.name === "next-data") {
      const next = await page.evaluate(() => {
        const node =
          document.querySelector<HTMLScriptElement>("#__NEXT_DATA__");
        if (!node?.textContent) return null;
        try {
          const value = JSON.parse(node.textContent) as {
            page?: unknown;
            query?: unknown;
          };
          return {
            page: typeof value.page === "string" ? value.page : "",
            query:
              value.query && typeof value.query === "object"
                ? JSON.stringify(value.query)
                : "",
          };
        } catch {
          return null;
        }
      });
      if (next?.page) {
        signals["next.page"] = next.page.slice(0, 500);
        if (next.query) signals["next.query"] = next.query.slice(0, 1_000);
        applied.push(key);
      } else {
        warnings.push(
          `${key} was unavailable or invalid; black-box signals remain active.`,
        );
      }
    }
  }

  const requiredMissing = configs.filter(
    (config) => config.required && !applied.includes(adapterKey(config)),
  );
  if (requiredMissing.length > 0)
    throw new Error(
      `Required framework adapter signal missing: ${requiredMissing.map(adapterKey).join(", ")}.`,
    );

  return { signals, warnings, applied };
}
