/** Defers make clicks feel dead, so each one must say why the work can't finish in 3 seconds. */
import { Glob } from "bun";
import { relative } from "node:path";
import ts from "typescript";

const DEFER_METHODS = new Set(["deferReply", "deferUpdate"]);
const JUSTIFICATION = /^\s*\/\/\s*defer:\s*\S/;
const LINE_COMMENT = /^\s*\/\//;

export interface UnjustifiedDefer {
  file: string;
  line: number;
}

/** Matches every way the method can be reached: `.x`, `?.x`, `["x"]`, `.x.bind(...)`, `{ x } =`. */
function deferNameNode(node: ts.Node): ts.Node | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    DEFER_METHODS.has(node.name.text)
  ) {
    return node.name;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    DEFER_METHODS.has(node.argumentExpression.text)
  ) {
    return node.argumentExpression;
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = node.propertyName ?? node.name;
    if (ts.isIdentifier(key) && DEFER_METHODS.has(key.text)) {
      return key;
    }
  }
  if (
    (ts.isShorthandPropertyAssignment(node) || ts.isPropertyAssignment(node)) &&
    ts.isIdentifier(node.name) &&
    DEFER_METHODS.has(node.name.text) &&
    isAssignmentTarget(node.parent)
  ) {
    return node.name;
  }
  return null;
}

/** `({ deferUpdate } = i)`: an object literal on the left of `=`, possibly nested. */
function isAssignmentTarget(node: ts.Node): boolean {
  let current = node;
  while (
    ts.isObjectLiteralExpression(current.parent) ||
    ts.isPropertyAssignment(current.parent) ||
    ts.isParenthesizedExpression(current.parent)
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === current
  );
}

/** A comment justifies only what sits in the same statement, never defers inside nested functions, cases or members. */
function isStatementBoundary(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isFunctionLike(node) ||
    ts.isClassElement(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node)
  );
}

function enclosingStatement(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && !isStatementBoundary(current.parent)) {
    current = current.parent;
  }
  return current;
}

function justifiedAbove(lines: string[], lineIndex: number): boolean {
  for (let i = lineIndex - 1; i >= 0 && LINE_COMMENT.test(lines[i]); i--) {
    if (JUSTIFICATION.test(lines[i])) {
      return true;
    }
  }
  return false;
}

export function findUnjustifiedDefers(
  file: string,
  source: string,
): UnjustifiedDefer[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const lines = source.split("\n");
  const found: UnjustifiedDefer[] = [];

  const visit = (node: ts.Node): void => {
    const name = deferNameNode(node);
    if (name) {
      const line = sourceFile.getLineAndCharacterOfPosition(
        name.getStart(),
      ).line;
      const statementLine = sourceFile.getLineAndCharacterOfPosition(
        enclosingStatement(node).getStart(),
      ).line;
      // The comment may sit above the defer itself or above a statement that wraps onto it.
      if (
        !justifiedAbove(lines, line) &&
        !justifiedAbove(lines, statementLine)
      ) {
        found.push({ file, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return found;
}

if (import.meta.main) {
  const root = new URL("../src", import.meta.url).pathname;
  const found: UnjustifiedDefer[] = [];

  for await (const path of new Glob("**/*.ts").scan({
    cwd: root,
    absolute: true,
  })) {
    if (path.endsWith(".test.ts")) {
      continue;
    }
    const source = await Bun.file(path).text();
    found.push(...findUnjustifiedDefers(relative(process.cwd(), path), source));
  }

  if (found.length > 0) {
    console.error(
      'Respond with reply()/update() instead of deferring, or justify the defer with a `// defer: <why this is slow, or "ack-only, <why nothing to render>">` comment on the line above:\n' +
        found.map((f) => `  ${f.file}:${f.line}`).join("\n"),
    );
    console.error(
      "Database CRUD is never a reason to defer. See .claude/rules/discord-interactions.md.",
    );
    process.exit(1);
  }
}
