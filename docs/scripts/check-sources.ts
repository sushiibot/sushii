// A changed hash means the cited code changed since someone last confirmed the claim beside it.
// Run with --update only after re-verifying the flagged claims.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(import.meta.path), "../..");
const DOCS_GLOB = "docs/content/docs/**/*.{md,mdx}";

const COMMENT_RE = /(\{\/\*|<!--)\s*source:\s*([\s\S]*?)\s*(\*\/\}|-->)/g;
const ENTRY_RE = /([^\s,#]+)#("[^"]*"|[\w$.]+)(?:\s+@([0-9a-f]{8}))?/g;

type Status = "ok" | "stale" | "unstamped" | "unresolved" | "broad";

// Wide anchors go stale on unrelated edits. Reported as a warning since some logic only
// lives in long methods.
const MAX_ANCHOR_LINES = 60;

interface Entry {
  path: string;
  anchor: string;
  hash?: string;
}

const sourceCache = new Map<string, ts.SourceFile | null>();

function loadSource(path: string): ts.SourceFile | null {
  if (!sourceCache.has(path)) {
    let sf: ts.SourceFile | null = null;
    try {
      const text = readFileSync(join(REPO_ROOT, path), "utf8");
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    } catch {
      sf = null;
    }
    sourceCache.set(path, sf);
  }
  return sourceCache.get(path) ?? null;
}

function nodeName(node: ts.Node): string | undefined {
  const name = (node as { name?: ts.Node }).name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))) {
    return name.text;
  }
  return undefined;
}

function topLevel(sf: ts.SourceFile, name: string): ts.Node | undefined {
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations.find((d) => nodeName(d) === name);
      if (decl) {
        return decl;
      }
    } else if (nodeName(stmt) === name) {
      return stmt;
    }
  }
  return undefined;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }
  return e;
}

function child(node: ts.Node, name: string): ts.Node | undefined {
  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    return node.members.find((m) => nodeName(m) === name);
  }
  if (ts.isEnumDeclaration(node)) {
    return node.members.find((m) => nodeName(m) === name);
  }
  const init =
    ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) ? node.initializer : undefined;
  if (init) {
    const obj = unwrapExpression(init);
    if (ts.isObjectLiteralExpression(obj)) {
      return obj.properties.find((p) => nodeName(p) === name);
    }
  }
  return undefined;
}

function literalTexts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  return [];
}

function findLiteral(sf: ts.SourceFile, text: string): ts.Node | undefined | "ambiguous" {
  const hits: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (literalTexts(node).some((t) => t.includes(text))) {
      hits.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (hits.length > 1) {
    return "ambiguous";
  }
  // Hash the smallest enclosing unit: a builder callback, property, member, or statement.
  let node: ts.Node | undefined = hits[0];
  while (
    node &&
    !ts.isArrowFunction(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isPropertyAssignment(node) &&
    !ts.isClassElement(node) &&
    !ts.isStatement(node)
  ) {
    node = node.parent;
  }
  return node;
}

function resolveAnchor(entry: Entry): { node?: ts.Node; error?: string } {
  const sf = loadSource(entry.path);
  if (!sf) {
    return { error: "file not found" };
  }
  if (entry.anchor.startsWith('"')) {
    const found = findLiteral(sf, entry.anchor.slice(1, -1));
    if (found === "ambiguous") {
      return { error: "string appears more than once" };
    }
    return found ? { node: found } : { error: "string not found" };
  }
  const [head, ...rest] = entry.anchor.split(".");
  let node = topLevel(sf, head);
  for (const part of rest) {
    node = node && child(node, part);
  }
  return node ? { node } : { error: "symbol not found" };
}

function hashNode(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function claimPreview(text: string, endIndex: number): string {
  const after = text.slice(endIndex).split("\n").find((l) => l.trim() && !l.includes("source:"));
  return (after ?? "").trim().slice(0, 80);
}

const update = process.argv.includes("--update");
const counts: Record<Status, number> = { ok: 0, stale: 0, unstamped: 0, unresolved: 0, broad: 0 };
const problems: string[] = [];

const fileArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const docPaths =
  fileArgs.length > 0
    ? fileArgs.map((p) => resolve(process.cwd(), p))
    : [...new Glob(DOCS_GLOB).scanSync({ cwd: REPO_ROOT })].map((p) => join(REPO_ROOT, p));

for (const abs of docPaths) {
  const original = readFileSync(abs, "utf8");

  const rewritten = original.replace(COMMENT_RE, (comment, open, body, close, offset) => {
    const line = lineOf(original, offset);
    const preview = claimPreview(original, offset + comment.length);

    const entries = [...body.matchAll(ENTRY_RE)].map((m) => {
      const entry: Entry = { path: m[1], anchor: m[2], hash: m[3] };
      const { node, error } = resolveAnchor(entry);
      const label = `${relative(REPO_ROOT, abs)}:${line} → ${entry.path}#${entry.anchor}`;

      if (!node) {
        counts.unresolved++;
        problems.push(`UNRESOLVED ${label} (${error})\n    ${preview}`);
        return `${entry.path}#${entry.anchor}${entry.hash ? ` @${entry.hash}` : ""}`;
      }

      const sf = node.getSourceFile();
      const lines =
        sf.getLineAndCharacterOfPosition(node.getEnd()).line -
        sf.getLineAndCharacterOfPosition(node.getStart()).line +
        1;
      if (lines > MAX_ANCHOR_LINES) {
        counts.broad++;
        problems.push(`BROAD      ${label} (${lines} lines, max ${MAX_ANCHOR_LINES})\n    ${preview}`);
      }

      const current = hashNode(node);
      if (update) {
        counts.ok++;
        return `${entry.path}#${entry.anchor} @${current}`;
      }
      if (!entry.hash) {
        counts.unstamped++;
        problems.push(`UNSTAMPED  ${label}\n    ${preview}`);
      } else if (entry.hash !== current) {
        counts.stale++;
        problems.push(`STALE      ${label}\n    ${preview}`);
      } else {
        counts.ok++;
      }
      return `${entry.path}#${entry.anchor}${entry.hash ? ` @${entry.hash}` : ""}`;
    });

    return `${open} source: ${entries.join(", ")} ${close}`;
  });

  if (update && rewritten !== original) {
    writeFileSync(abs, rewritten);
  }
}

for (const p of problems) {
  console.log(p);
}
console.log(
  `\n${counts.ok} ok, ${counts.stale} stale, ${counts.unstamped} unstamped, ${counts.unresolved} unresolved, ${counts.broad} broad (warning)`,
);

const failing = counts.unresolved + (update ? 0 : counts.stale + counts.unstamped);
if (failing > 0) {
  if (!update) {
    console.log(
      "\nRe-verify each flagged claim against the cited code, fix the docs if needed, then run with --update.",
    );
  }
  process.exit(1);
}
