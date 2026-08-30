/**
 * A capture is the shader truncated at the inspected line, so it only compiles
 * when everything above that line does. Finding where the source stops being
 * valid lets the capture stop there instead of failing wholesale.
 *
 * The compiler cannot answer this on its own: a stray `d` followed by
 * `p += ...` parses as a declaration of `p` with type `d`, so the error is
 * reported on the line after the mistake, and truncating there keeps the
 * mistake in. This finds the line that never became a statement.
 */

/**
 * Lines opening a block rather than ending a statement. A keyword only counts
 * as one when it carries what it needs: a bare `if` or `switch` left mid-edit
 * is exactly the unterminated statement being looked for.
 */
const CONTROL_HEAD = /^(?:(?:if|for|while|switch)\s*\(|(?:else|do)\b|case\b.*:|default\s*:)/;
const TERMINATORS = /[;{}:,]$/;
const CONTINUES = /[+\-*/%<>=&|^?~!(,[]$/;
/**
 * A line that starts a statement of its own, so nothing above it continues:
 * a keyword, a closing brace, or a declaration - `float frame = ...` cannot be
 * the tail of the expression on the line before it.
 */
const STATEMENT_START = /^(?:(?:return|if|for|while|switch|do|break|continue|discard)\b|[}#]|\w[\w<>]*\s+\w+\s*[=;([]|\w+(?:\.\w+)*\s*[-+*/%]?=[^=])/;
const PREPROCESSOR = /^#/;

/**
 * The first line inside a function body that never terminates a statement,
 * 1-based, or null when every statement is well formed.
 */
export function firstUnterminatedStatementLine(code: string): number | null {
  const lines = code.split("\n");

  let depth = 0;
  let openGroups = 0;
  let inBlockComment = false;
  /** Line that opened the brackets still standing, for a call never closed. */
  let openedGroupAt: number | null = null;
  let previousCode = "";

  for (let index = 0; index < lines.length; index += 1) {
    const { text, endsInBlockComment } = stripComments(lines[index], inBlockComment);
    inBlockComment = endsInBlockComment;
    const trimmed = text.trim();

    const groupDelta = countOf(text, "(") - countOf(text, ")")
      + countOf(text, "[") - countOf(text, "]");
    const insideStatement = openGroups > 0;
    if (openGroups === 0 && groupDelta > 0) {
      openedGroupAt = index;
    }
    openGroups = Math.max(0, openGroups + groupDelta);
    if (openGroups === 0) {
      openedGroupAt = null;
    }

    const braceDelta = countOf(text, "{") - countOf(text, "}");

    // Brackets still open where a new statement begins are never going to
    // close: `float v = max(acc,` followed by another statement is the break,
    // and it is the line that opened them that has to go.
    if (depth > 0 && openGroups > 0 && openedGroupAt !== null
      && trimmed.length > 0 && index > openedGroupAt
      && STATEMENT_START.test(trimmed)) {
      return openedGroupAt + 1;
    }

    // A control head with nothing to control: `switch (col)` needs a block,
    // and an `if`/`for`/`while` head followed by the end of its block never
    // got the statement it opens.
    if (depth > 0 && !insideStatement && openGroups === 0 && CONTROL_HEAD.test(trimmed)) {
      const follows = nextCode(lines, index);
      const needsBlock = /^switch\s*\(/.test(trimmed);
      const opensBlock = trimmed.endsWith("{") || follows.startsWith("{");
      if (needsBlock ? !opensBlock : (!opensBlock && (follows === "" || follows.startsWith("}")))) {
        return index + 1;
      }
    }

    // `else` only belongs to an `if` that just ended, with a block or a single
    // statement. Anything else is a keyword left behind.
    if (depth > 0 && !insideStatement && /^else\b/.test(trimmed)
      && previousCode !== "" && !/[;}]$/.test(previousCode)) {
      return index + 1;
    }

    // Only statements inside a function body can be commented out safely; at
    // file scope the same shape is a declaration the rest of the code needs.
    if (
      depth > 0
      && !insideStatement
      && openGroups === 0
      && braceDelta === 0
      && trimmed.length > 0
      && !PREPROCESSOR.test(trimmed)
      && !CONTROL_HEAD.test(trimmed)
      && !TERMINATORS.test(trimmed)
      // An operator at the end of a line only continues onto the next one when
      // that line carries on the expression. `float test =` followed by
      // `return ...` never completes, and is exactly the break being sought.
      && (!CONTINUES.test(trimmed) || STATEMENT_START.test(nextCode(lines, index)))
    ) {
      return index + 1;
    }

    depth = Math.max(0, depth + braceDelta);
    if (trimmed.length > 0) {
      previousCode = trimmed;
    }
  }

  // Brackets left open when the file ends never closed either.
  return openGroups > 0 && openedGroupAt !== null ? openedGroupAt + 1 : null;
}

/** The next line with code on it, stripped of comments and indentation. */
function nextCode(lines: string[], index: number): string {
  for (let next = index + 1; next < lines.length; next += 1) {
    const text = lines[next].replace(/\/\/.*$/, "").trim();
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

function countOf(text: string, character: string): number {
  let count = 0;
  for (const value of text) {
    if (value === character) {
      count += 1;
    }
  }
  return count;
}

/** Blanks out comment and string content so their punctuation does not count. */
function stripComments(line: string, inBlockComment: boolean): { text: string; endsInBlockComment: boolean } {
  let result = "";
  let blockComment = inBlockComment;
  let index = 0;

  while (index < line.length) {
    if (blockComment) {
      const end = line.indexOf("*/", index);
      if (end < 0) {
        return { text: result, endsInBlockComment: true };
      }
      blockComment = false;
      index = end + 2;
      continue;
    }
    if (line.startsWith("//", index)) {
      break;
    }
    if (line.startsWith("/*", index)) {
      blockComment = true;
      index += 2;
      continue;
    }
    if (line[index] === '"' || line[index] === "'") {
      const quote = line[index];
      index += 1;
      while (index < line.length && line[index] !== quote) {
        index += line[index] === "\\" ? 2 : 1;
      }
      index += 1;
      continue;
    }
    result += line[index];
    index += 1;
  }

  return { text: result, endsInBlockComment: blockComment };
}

/** Enclosing function of a line, located by brace matching. */
export function enclosingFunctionRange(code: string, line: number): { start: number; end: number } | null {
  const found = enclosingFunction(code.split("\n"), line - 1);
  return found ? { start: found.start + 1, end: found.end + 1 } : null;
}

function enclosingFunction(lines: string[], line: number): { start: number; end: number; returnType: string } | null {
  const signature = /^\s*(\w[\w<>, ]*?)\s+(\w+)\s*\([^;]*\)\s*\{?\s*$/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].replace(/\/\/.*$/, "").match(signature);
    if (!match) {
      continue;
    }
    const end = blockEnd(lines, index);
    if (end > index && line >= index && line <= end) {
      return { start: index, end, returnType: match[1].trim() };
    }
  }
  return null;
}

function blockEnd(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const character of lines[index].replace(/\/\/.*$/, "")) {
      if (character === "{") {
        depth += 1;
        opened = true;
      } else if (character === "}") {
        depth -= 1;
        if (opened && depth === 0) {
          return index;
        }
      }
    }
  }
  return -1;
}

/**
 * A value of `type` to return from a function cut short. Constructor syntax
 * rather than a cast: `(float)0` is Slang-only and a syntax error in GLSL.
 */
function defaultReturn(returnType: string): string {
  return returnType === "void" ? "return;" : `return ${returnType}(0);`;
}

/**
 * The source with the enclosing function's body cut just above `line`: the cut
 * lines are blanked rather than removed, so every line below keeps its number
 * and the inspected line still means what it did. A value of the function's own
 * type is returned where the break was, and the rest of the module is left
 * alone - Slang resolves functions defined further down, so cutting the file
 * would drop definitions the code above calls.
 *
 * Returns null when no function encloses the line.
 */
export function truncateFunctionBodyAt(code: string, line: number): string | null {
  const lines = code.split("\n");
  const zeroBased = line - 1;
  const enclosing = enclosingFunction(lines, zeroBased);
  if (!enclosing || zeroBased <= enclosing.start || zeroBased >= enclosing.end) {
    return null;
  }

  let depth = 0;
  for (const text of lines.slice(enclosing.start, zeroBased)) {
    for (const character of text.replace(/\/\/.*$/, "")) {
      if (character === "{") {
        depth += 1;
      }
      if (character === "}") {
        depth -= 1;
      }
    }
  }
  if (depth <= 0) {
    return null;
  }

  const result = [...lines];
  for (let index = zeroBased; index < enclosing.end; index += 1) {
    result[index] = "";
  }

  // The break line is left empty and the return goes on the line after it, so
  // a capture capped to the break lands on a plain statement position at the
  // body's own depth - not on the closing brace of a block that just ended,
  // where that block's variables are still being reported.
  const returnLine = zeroBased + 1 < enclosing.end ? zeroBased + 1 : zeroBased;
  result[returnLine] = [defaultReturn(enclosing.returnType), ...new Array(depth - 1).fill("}")].join(" ");
  result[enclosing.end] = "}";
  return result.join("\n");
}
