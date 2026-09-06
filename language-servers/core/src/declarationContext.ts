import type { Position } from "vscode-languageserver-protocol";

/**
 * What the cursor is positioned to write next.
 *
 * - `declarator`: a type has just been written, so the next word names a new
 *   variable. Nothing that already exists belongs here.
 * - `statement-start`: the beginning of a statement, where a declaration is the
 *   likeliest thing to follow, so types lead the list.
 * - `expression`: anywhere else, where existing symbols lead and a type is only
 *   a constructor.
 */
export type DeclarationContext = "declarator" | "statement-start" | "expression";

/** Qualifiers that may sit between the start of a declaration and its type. */
const DECLARATION_QUALIFIERS = new Set([
  "const", "in", "out", "inout", "uniform", "varying", "attribute", "buffer", "shared",
  "centroid", "sample", "patch", "flat", "smooth", "noperspective", "invariant", "precise",
  "lowp", "mediump", "highp", "coherent", "volatile", "restrict", "readonly", "writeonly",
  "static", "groupshared", "extern", "export", "public", "internal", "private",
  "nointerpolation", "linear", "row_major", "column_major", "globallycoherent",
]);

/** A type with its array or generic suffix, as written before the name being declared. */
const TYPE_BEFORE_NAME = /([A-Za-z_]\w*)(?:<[^<>]*>)?(?:\s*\[[^\]]*\])?\s+[A-Za-z_]\w*$/;

/** A bare word at the cursor, with everything written before it on the line. */
function lineBeforeCursor(source: string, position: Position): string | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  return line.slice(0, position.character);
}

/**
 * Classify what the cursor is about to write, so completion can lead with types
 * where a declaration is likely and offer nothing where a new name is being
 * invented. `isType` decides which words count as types for the language, and
 * should accept user-declared structs as well as built-in type keywords.
 */
export function declarationContext(
  source: string,
  position: Position,
  isType: (word: string) => boolean,
): DeclarationContext {
  const before = lineBeforeCursor(source, position);
  if (before === undefined) {
    return "expression";
  }
  // The word under the cursor is still being typed, so it is not yet context.
  const written = before.replace(/[A-Za-z0-9_]*$/, "");
  const trimmed = written.trimEnd();

  // `float3 na|` - the type is written and this word is the new name.
  const declared = before.match(TYPE_BEFORE_NAME);
  if (declared && isType(declared[1]!) && written.length < before.length) {
    return "declarator";
  }
  // `float3 |` - the space after a type opens the same position.
  const afterType = trimmed.match(/([A-Za-z_]\w*)(?:<[^<>]*>)?(?:\s*\[[^\]]*\])?$/);
  if (
    written !== trimmed
    && afterType
    && isType(afterType[1]!)
    && !trimmed.endsWith("(")
  ) {
    return "declarator";
  }

  // Only whitespace, a block brace, or a finished statement before the cursor.
  if (/(?:^|[{};])\s*$/.test(written)) {
    return "statement-start";
  }
  // Qualifiers open a declaration too: `const |` still wants a type.
  const qualifier = trimmed.match(/([A-Za-z_]\w*)$/);
  if (written !== trimmed && qualifier && DECLARATION_QUALIFIERS.has(qualifier[1]!)) {
    return "statement-start";
  }
  return "expression";
}

/**
 * Order a completion list for what the cursor is about to write. Types lead at
 * the start of a statement, where a declaration is the likeliest next thing,
 * and fall back behind the symbols in scope anywhere else, where a type is only
 * a constructor. Ordering is by `sortText`, so every item keeps its place in
 * the list rather than being filtered out.
 */
export function rankCompletionsForContext<T extends { label: string; sortText?: string }>(
  items: readonly T[],
  context: DeclarationContext,
  isTypeLabel: (label: string) => boolean,
): T[] {
  const typesLead = context === "statement-start";
  return items.map((item) => ({
    ...item,
    sortText: `${isTypeLabel(item.label) === typesLead ? "0" : "1"}${item.label}`,
  }));
}

/**
 * Whether the cursor sits inside a block rather than at file scope. A
 * declaration means different things in the two places: a function at file
 * scope, a variable inside a body.
 */
export function isInsideBlock(source: string, position: Position): boolean {
  const lines = source.split("\n");
  if (position.line < 0 || position.line >= lines.length) {
    return false;
  }
  const before = [
    ...lines.slice(0, position.line),
    lines[position.line]!.slice(0, position.character),
  ].join("\n");
  // Braces inside comments and strings are text, not structure.
  const code = before
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  let depth = 0;
  for (const character of code) {
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    }
  }
  return depth > 0;
}
