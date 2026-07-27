import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

import {
  StateScryError,
  validateConfig,
  type StateScryConfig,
} from "@statescry/core";

export interface ProjectDetection {
  framework: string;
  defaultUrl: string;
  playwrightConfigured: boolean;
}

export interface InitializeResult extends ProjectDetection {
  configPath: string;
  baseUrl: string;
  config: StateScryConfig;
  nextCommands: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function packageDependencies(
  projectRoot: string,
): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...parsed.dependencies, ...parsed.devDependencies };
  } catch {
    return {};
  }
}

export async function detectProject(
  projectRoot: string,
): Promise<ProjectDetection> {
  const dependencies = await packageDependencies(projectRoot);
  let framework = "web";
  let defaultUrl = "http://127.0.0.1:3000";
  if (dependencies.next) framework = "Next.js";
  else if (dependencies.nuxt) framework = "Nuxt";
  else if (dependencies["@sveltejs/kit"]) framework = "SvelteKit";
  else if (dependencies["@angular/core"]) {
    framework = "Angular";
    defaultUrl = "http://127.0.0.1:4200";
  } else if (dependencies.vite) {
    framework = dependencies.react
      ? "React + Vite"
      : dependencies.vue
        ? "Vue + Vite"
        : dependencies.svelte
          ? "Svelte + Vite"
          : "Vite";
    defaultUrl = "http://127.0.0.1:5173";
  } else if (dependencies["react-scripts"]) {
    framework = "Create React App";
  }
  const playwrightConfigured = (
    await Promise.all(
      [
        "playwright.config.ts",
        "playwright.config.js",
        "playwright.config.mts",
        "playwright.config.mjs",
      ].map((file) => exists(resolve(projectRoot, file))),
    )
  ).some(Boolean);
  return { framework, defaultUrl, playwrightConfigured };
}

function safeBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new StateScryError(
      "INVALID_URL",
      `Application URL is invalid: ${value}`,
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new StateScryError(
      "INVALID_URL",
      "Application URL must use HTTP or HTTPS.",
    );
  return parsed;
}

export async function initializeProject(
  projectRoot: string,
  requestedUrl?: string,
  force = false,
): Promise<InitializeResult> {
  const root = resolve(projectRoot);
  const configPath = resolve(root, "statescry.config.json");
  if ((await exists(configPath)) && !force)
    throw new StateScryError(
      "CONFIG_EXISTS",
      "statescry.config.json already exists. Review it or pass --force to replace it explicitly.",
    );
  const detection = await detectProject(root);
  const baseUrl = safeBaseUrl(requestedUrl ?? detection.defaultUrl);
  const config = validateConfig({
    browser: "chromium",
    headless: true,
    maxStates: 100,
    maxDepth: 8,
    maxActionsPerState: 40,
    explorationMode: "observe",
    evidenceMode: "metadata",
    allowedOrigins: [baseUrl.origin],
    personas: { default: { role: "anonymous" } },
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 },
    },
  });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    ...detection,
    configPath,
    baseUrl: baseUrl.href.replace(/\/$/, ""),
    config,
    nextCommands: [
      "statescry validate",
      `statescry map ${baseUrl.href.replace(/\/$/, "")} --name baseline`,
      "statescry show",
    ],
  };
}
