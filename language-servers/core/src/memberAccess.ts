import type { Position } from "vscode-languageserver-protocol";

export interface MemberAccess {
  /** Source text of the expression the member is selected from, such as `uv` or `lights[0].color`. */
  readonly expression: string;
  /** Member characters already typed after the selector. */
  readonly prefix: string;
}

const IDENTIFIER_CHARACTER = /[A-Za-z0-9_]/;
const NUMERIC_LITERAL = /^\d+(?:\.\d*)?$/;
const CLOSING_BRACKETS: Readonly<Record<string, string>> = { ")": "(", "]": "[", ">": "<" };

/**
 * Describes the member selection being typed at `position`, so completion can offer
 * the members of the selected expression instead of every symbol in scope.
 * Only the cursor line is inspected; expressions wrapped across lines report nothing.
 */
export function findMemberAccess(source: string, position: Position): MemberAccess | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  const before = line.slice(0, position.character);
  const prefix = before.match(/[A-Za-z0-9_]*$/)?.[0] ?? "";
  const selector = skipWhitespaceBackwards(before, before.length - prefix.length - 1);
  if (before[selector] !== ".") {
    return undefined;
  }
  const start = expressionStart(before, selector);
  const expression = start === undefined ? "" : before.slice(start, selector).trim();
  return expression && !NUMERIC_LITERAL.test(expression) ? { expression, prefix } : undefined;
}

const SWIZZLE_SELECTION_CACHE = new Map<string, string[]>();

/** Component selections offered for reading a vector of `size` components. */
export function swizzleSelections(size: number, sets: readonly string[]): string[] {
  if (!Number.isInteger(size) || size < 2 || size > 4) {
    return [];
  }
  const key = `${size}:${sets.join(",")}`;
  const cached = SWIZZLE_SELECTION_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const common = sets.flatMap((set) => {
    const components = [...set].slice(0, size);
    const runs = components.map((_, index) => components.slice(0, index + 1).join("")).slice(1);
    return [...components, ...runs];
  });
  const commonSet = new Set(common);
  const remaining = sets.flatMap((set) => allSelections([...set].slice(0, size)))
    .filter((selection) => !commonSet.has(selection))
    .sort((left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0));
  const selections = [...common, ...remaining];
  SWIZZLE_SELECTION_CACHE.set(key, selections);
  return selections;
}

function allSelections(components: readonly string[]): string[] {
  let previous = [""];
  const result: string[] = [];
  for (let length = 1; length <= 4; length++) {
    previous = previous.flatMap((prefix) => components.map((component) => prefix + component));
    result.push(...previous);
  }
  return result;
}

export type MemberExpressionStep =
  | { readonly kind: "identifier" | "call" | "member"; readonly name: string }
  | { readonly kind: "index" };

/**
 * Splits an expression such as `lights[0].color` into the steps a type resolver walks.
 * Reports no steps for anything that is not a plain selection chain, such as `(a + b)`.
 */
export function parseMemberExpression(expression: string): readonly MemberExpressionStep[] {
  const steps: MemberExpressionStep[] = [];
  let index = 0;
  const skipSpaces = () => {
    while (/\s/.test(expression[index] ?? "")) {
      index++;
    }
  };
  const readName = () => {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index));
    index += match?.[0].length ?? 0;
    return match?.[0];
  };
  const skipBracketed = (open: string, close: string) => {
    let depth = 0;
    while (index < expression.length) {
      const character = expression[index++];
      depth += character === open ? 1 : character === close ? -1 : 0;
      if (depth === 0) {
        return true;
      }
    }
    return false;
  };

  skipSpaces();
  const name = readName();
  if (!name) {
    return [];
  }
  skipSpaces();
  if (expression[index] === "(") {
    if (!skipBracketed("(", ")")) {
      return [];
    }
    steps.push({ kind: "call", name });
  } else {
    steps.push({ kind: "identifier", name });
  }
  for (;;) {
    skipSpaces();
    if (index >= expression.length) {
      return steps;
    }
    if (expression[index] === ".") {
      index++;
      skipSpaces();
      const member = readName();
      if (!member) {
        return [];
      }
      steps.push({ kind: "member", name: member });
      continue;
    }
    if (expression[index] === "[") {
      if (!skipBracketed("[", "]")) {
        return [];
      }
      steps.push({ kind: "index" });
      continue;
    }
    return [];
  }
}

/** Index of the first character of the expression ending at `selector`, or undefined when there is none. */
function expressionStart(line: string, selector: number): number | undefined {
  let index = selector - 1;
  let start: number | undefined;
  for (;;) {
    index = skipWhitespaceBackwards(line, index);
    const opening = CLOSING_BRACKETS[line[index] ?? ""];
    if (opening) {
      // A call or index suffix; the callee or array name may still precede it.
      const match = matchingBracket(line, index, opening);
      if (match === undefined) {
        return undefined;
      }
      start = match;
      index = match - 1;
      continue;
    }
    if (!IDENTIFIER_CHARACTER.test(line[index] ?? "")) {
      return start;
    }
    while (index >= 0 && IDENTIFIER_CHARACTER.test(line[index] ?? "")) {
      index--;
    }
    start = index + 1;
    index = skipWhitespaceBackwards(line, index);
    if (line[index] !== ".") {
      return start;
    }
    index--;
  }
}

function matchingBracket(line: string, closing: number, opening: string): number | undefined {
  let depth = 0;
  for (let index = closing; index >= 0; index--) {
    if (line[index] === line[closing]) {
      depth++;
    } else if (line[index] === opening) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function skipWhitespaceBackwards(line: string, from: number): number {
  let index = from;
  while (index >= 0 && /\s/.test(line[index] ?? "")) {
    index--;
  }
  return index;
}
