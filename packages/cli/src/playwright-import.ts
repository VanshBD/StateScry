import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import ts from "typescript";

export interface ImportedJourneyStep {
  kind: "click" | "fill" | "press" | "select" | "check";
  selector: string;
  label: string;
  value?: string;
  key?: string;
  secretValue?: boolean;
  sourceLine: number;
}

export interface ImportedJourneyAssertion {
  type: "selector";
  selector: string;
  expected: "visible";
  sourceLine: number;
}

export interface ImportedJourney {
  name: string;
  sourceFile: string;
  startUrl?: string;
  steps: ImportedJourneyStep[];
  assertions: ImportedJourneyAssertion[];
}

export interface ImportDiagnostic {
  file: string;
  line: number;
  severity: "warning" | "error";
  code:
    | "UNSUPPORTED_LOCATOR"
    | "UNSUPPORTED_ACTION"
    | "DYNAMIC_VALUE"
    | "CONDITIONAL_FLOW"
    | "NO_SUPPORTED_STEPS"
    | "PARSE_ERROR";
  message: string;
}

export interface PlaywrightImportArtifact {
  schemaVersion: 1;
  source: "playwright";
  journeys: ImportedJourney[];
  diagnostics: ImportDiagnostic[];
  summary: {
    files: number;
    journeys: number;
    steps: number;
    assertions: number;
    warnings: number;
    errors: number;
  };
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
]);
const SECRET_SELECTOR = /password|secret|token|api[-_]?key|credential/i;

async function collectSourceFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const info = await stat(path);
    if (info.isDirectory()) {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (["node_modules", "dist", ".git", ".statescry"].includes(entry.name))
          continue;
        await visit(resolve(path, entry.name));
      }
      return;
    }
    if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path);
  };
  for (const path of paths) await visit(resolve(path));
  return [...new Set(files)].sort();
}

function stringLiteral(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function testCall(
  node: ts.CallExpression,
): { name: string; body: ts.Block } | null {
  const expression = node.expression;
  const isTest =
    (ts.isIdentifier(expression) && expression.text === "test") ||
    (ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "test");
  if (!isTest) return null;
  const name = stringLiteral(node.arguments[0]);
  const callback = node.arguments[1];
  if (
    !name ||
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body)
  )
    return null;
  return { name, body: callback.body };
}

function pageLocator(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  if (call.expression.name.text !== "locator") return undefined;
  if (
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "page"
  )
    return undefined;
  return stringLiteral(call.arguments[0]);
}

function unsupportedLocatorName(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  if (
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "page"
  )
    return undefined;
  const name = call.expression.name.text;
  return name.startsWith("getBy") ? name : undefined;
}

function actionFromCall(
  call: ts.CallExpression,
  source: ts.SourceFile,
  file: string,
  diagnostics: ImportDiagnostic[],
): ImportedJourneyStep | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  if (!["click", "fill", "press", "selectOption", "check"].includes(method))
    return null;
  const receiver = call.expression.expression;
  if (!ts.isCallExpression(receiver)) return null;
  const selector = pageLocator(receiver);
  if (!selector) {
    const unsupported = unsupportedLocatorName(receiver);
    diagnostics.push({
      file,
      line: lineOf(source, call),
      severity: "warning",
      code: "UNSUPPORTED_LOCATOR",
      message: unsupported
        ? `${unsupported} is not converted because StateScry will not invent a CSS selector.`
        : "Only literal page.locator(selector) actions are imported.",
    });
    return null;
  }
  const sourceLine = lineOf(source, call);
  if (method === "click")
    return { kind: "click", selector, label: `Click ${selector}`, sourceLine };
  if (method === "check")
    return { kind: "check", selector, label: `Check ${selector}`, sourceLine };
  const literal = stringLiteral(call.arguments[0]);
  if (literal === undefined) {
    diagnostics.push({
      file,
      line: sourceLine,
      severity: "warning",
      code: "DYNAMIC_VALUE",
      message: `${method} uses a dynamic value and was not imported.`,
    });
    return null;
  }
  if (method === "press")
    return {
      kind: "press",
      selector,
      label: `Press ${literal} on ${selector}`,
      key: literal,
      sourceLine,
    };
  const kind = method === "selectOption" ? "select" : "fill";
  const secretValue = kind === "fill" && SECRET_SELECTOR.test(selector);
  return {
    kind,
    selector,
    label: `${kind === "select" ? "Select" : "Fill"} ${selector}`,
    ...(secretValue ? { secretValue: true } : { value: literal }),
    sourceLine,
  };
}

function assertionFromCall(
  call: ts.CallExpression,
  source: ts.SourceFile,
): ImportedJourneyAssertion | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  if (call.expression.name.text !== "toBeVisible") return null;
  const expectCall = call.expression.expression;
  if (
    !ts.isCallExpression(expectCall) ||
    !ts.isIdentifier(expectCall.expression) ||
    expectCall.expression.text !== "expect"
  )
    return null;
  const locator = expectCall.arguments[0];
  if (!locator || !ts.isCallExpression(locator)) return null;
  const selector = pageLocator(locator);
  return selector
    ? {
        type: "selector",
        selector,
        expected: "visible",
        sourceLine: lineOf(source, call),
      }
    : null;
}

function parseFile(
  projectRoot: string,
  path: string,
  text: string,
): {
  journeys: ImportedJourney[];
  diagnostics: ImportDiagnostic[];
} {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const file = relative(projectRoot, path).split(sep).join("/");
  const parseDiagnostics =
    (
      source as ts.SourceFile & {
        parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
      }
    ).parseDiagnostics ?? [];
  const diagnostics: ImportDiagnostic[] = parseDiagnostics.map(
    (diagnostic: ts.DiagnosticWithLocation) => ({
      file,
      line:
        diagnostic.start === undefined
          ? 1
          : source.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
      severity: "error",
      code: "PARSE_ERROR",
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    }),
  );
  const journeys: ImportedJourney[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const test = testCall(node);
      if (test) {
        const steps: ImportedJourneyStep[] = [];
        const assertions: ImportedJourneyAssertion[] = [];
        let startUrl: string | undefined;
        const inspect = (child: ts.Node, conditional = false) => {
          const nextConditional =
            conditional ||
            ts.isIfStatement(child) ||
            ts.isForStatement(child) ||
            ts.isForOfStatement(child) ||
            ts.isWhileStatement(child) ||
            ts.isSwitchStatement(child) ||
            ts.isTryStatement(child);
          if (ts.isCallExpression(child)) {
            if (
              ts.isPropertyAccessExpression(child.expression) &&
              child.expression.name.text === "goto" &&
              ts.isIdentifier(child.expression.expression) &&
              child.expression.expression.text === "page"
            ) {
              const literal = stringLiteral(child.arguments[0]);
              if (literal) startUrl = literal;
              else
                diagnostics.push({
                  file,
                  line: lineOf(source, child),
                  severity: "warning",
                  code: "DYNAMIC_VALUE",
                  message: "Dynamic page.goto URL was not imported.",
                });
            }
            const action = actionFromCall(child, source, file, diagnostics);
            const assertion = assertionFromCall(child, source);
            if ((action || assertion) && nextConditional) {
              diagnostics.push({
                file,
                line: lineOf(source, child),
                severity: "warning",
                code: "CONDITIONAL_FLOW",
                message:
                  "An action inside conditional or repeated control flow was skipped.",
              });
            } else {
              if (action) steps.push(action);
              if (assertion) assertions.push(assertion);
            }
          }
          child.forEachChild((nested) => inspect(nested, nextConditional));
        };
        inspect(test.body);
        if (steps.length === 0)
          diagnostics.push({
            file,
            line: lineOf(source, node),
            severity: "warning",
            code: "NO_SUPPORTED_STEPS",
            message: `Test "${test.name}" contained no safely importable locator actions.`,
          });
        journeys.push({
          name: test.name,
          sourceFile: file,
          ...(startUrl ? { startUrl } : {}),
          steps: steps.sort(
            (left, right) => left.sourceLine - right.sourceLine,
          ),
          assertions: assertions.sort(
            (left, right) => left.sourceLine - right.sourceLine,
          ),
        });
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return { journeys, diagnostics };
}

export async function importPlaywrightJourneys(
  projectRoot: string,
  requestedPaths: string[],
  outputPath: string,
): Promise<PlaywrightImportArtifact> {
  const root = resolve(projectRoot);
  const files = await collectSourceFiles(
    requestedPaths.map((path) => resolve(root, path)),
  );
  const journeys: ImportedJourney[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  for (const file of files) {
    const parsed = parseFile(root, file, await readFile(file, "utf8"));
    journeys.push(...parsed.journeys);
    diagnostics.push(...parsed.diagnostics);
  }
  journeys.sort((left, right) =>
    `${left.sourceFile}:${left.name}`.localeCompare(
      `${right.sourceFile}:${right.name}`,
    ),
  );
  diagnostics.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.code.localeCompare(right.code),
  );
  const artifact: PlaywrightImportArtifact = {
    schemaVersion: 1,
    source: "playwright",
    journeys,
    diagnostics,
    summary: {
      files: files.length,
      journeys: journeys.length,
      steps: journeys.reduce(
        (total, journey) => total + journey.steps.length,
        0,
      ),
      assertions: journeys.reduce(
        (total, journey) => total + journey.assertions.length,
        0,
      ),
      warnings: diagnostics.filter((item) => item.severity === "warning")
        .length,
      errors: diagnostics.filter((item) => item.severity === "error").length,
    },
  };
  const target = resolve(root, outputPath);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}
