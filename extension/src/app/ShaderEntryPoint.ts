/**
 * Whether a source file is a shader in its own right, or a helper that belongs
 * to one. The answer decides whether the file is sent to the viewer as a whole
 * shader or previewed as a bare file, so a wrong answer is visible: a helper
 * routed as a shader replaces the picture and empties the viewer's state.
 *
 * A substring test for "mainImage" answered yes to a comment mentioning it, a
 * call to it, and a name that merely starts with it. Only a definition counts:
 * the name, a parameter list, and a body.
 */

/**
 * Comments and string literals, blanked out so what is left is code. Blanked
 * rather than deleted: removing them would join the tokens either side into
 * one, which is how a commented-out definition becomes a real-looking match.
 */
export function stripCommentsAndStrings(code: string): string {
  let out = "";
  let index = 0;
  while (index < code.length) {
    const two = code.slice(index, index + 2);
    if (two === "//") {
      while (index < code.length && code[index] !== "\n") {
        out += " ";
        index++;
      }
      continue;
    }
    if (two === "/*") {
      const end = code.indexOf("*/", index + 2);
      const stop = end === -1 ? code.length : end + 2;
      for (; index < stop; index++) {
        out += code[index] === "\n" ? "\n" : " ";
      }
      continue;
    }
    const quote = code[index];
    if (quote === '"' || quote === "'") {
      out += " ";
      index++;
      while (index < code.length && code[index] !== quote) {
        if (code[index] === "\\") {
          out += " ";
          index++;
        }
        if (index < code.length) {
          out += code[index] === "\n" ? "\n" : " ";
          index++;
        }
      }
      if (index < code.length) {
        out += " ";
        index++;
      }
      continue;
    }
    out += code[index];
    index++;
  }
  return out;
}

/** True when the source defines the `mainImage` entry point, in GLSL, Slang, or WGSL. */
export function definesMainImage(code: string): boolean {
  const source = stripCommentsAndStrings(code);
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const nameStart = source.indexOf("mainImage", searchFrom);
    if (nameStart === -1) {
      return false;
    }
    const before = source[nameStart - 1];
    const after = source[nameStart + "mainImage".length];
    if ((!before || !isIdentifierPart(before)) && (!after || !isIdentifierPart(after))) {
      const bodyStart = mainImageBodyStart(source, nameStart + "mainImage".length);
      if (bodyStart !== -1) {
        return true;
      }
    }
    searchFrom = nameStart + "mainImage".length;
  }
  return false;
}

function mainImageBodyStart(source: string, start: number): number {
  let index = skipWhitespace(source, start);
  if (source[index] !== "(") {
    return -1;
  }
  index = consumeDelimited(source, index, "(", ")");
  if (index === -1) {
    return -1;
  }
  index = skipWhitespace(source, index);

  if (source[index] === ":") {
    index = skipWhitespace(source, index + 1);
    index = consumeIdentifier(source, index);
    if (index === -1) {
      return -1;
    }
    index = skipWhitespace(source, index);
  } else if (source.startsWith("->", index)) {
    index = skipWhitespace(source, index + 2);
    while (source[index] === "@") {
      index = consumeIdentifier(source, index + 1);
      if (index === -1) {
        return -1;
      }
      index = skipWhitespace(source, index);
      if (source[index] === "(") {
        index = consumeDelimited(source, index, "(", ")");
        if (index === -1) {
          return -1;
        }
        index = skipWhitespace(source, index);
      }
    }
    index = consumeIdentifier(source, index);
    if (index === -1) {
      return -1;
    }
    index = skipWhitespace(source, index);
    if (source[index] === "<") {
      index = consumeDelimited(source, index, "<", ">");
      if (index === -1) {
        return -1;
      }
      index = skipWhitespace(source, index);
    }
  }

  return source[index] === "{" ? index : -1;
}

function consumeDelimited(source: string, start: number, open: string, close: string): number {
  if (source[start] !== open) {
    return -1;
  }
  let depth = 1;
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index]!;
    if (character === ";" || character === "{") {
      return -1;
    }
    if (character === open) {
      depth++;
    } else if (character === close && --depth === 0) {
      return index + 1;
    }
  }
  return -1;
}

function consumeIdentifier(source: string, start: number): number {
  if (!isIdentifierStart(source[start])) {
    return -1;
  }
  let index = start + 1;
  while (isIdentifierPart(source[index])) {
    index++;
  }
  return index;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && source.charCodeAt(index) <= 32) {
    index++;
  }
  return index;
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && (character === "_"
    || (character >= "a" && character <= "z")
    || (character >= "A" && character <= "Z"));
}

function isIdentifierPart(character: string | undefined): boolean {
  return isIdentifierStart(character)
    || (character !== undefined && character >= "0" && character <= "9");
}
