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
 * `mainImage(...)` followed by a body - Slang's trailing semantic (`: SV_Target`)
 * included. Parameter lists hold neither braces nor statements, so a call or a
 * forward declaration, which ends in `;`, cannot match.
 */
const MAIN_IMAGE_DEFINITION = /\bmainImage\s*\([^;{}()]*\)\s*(?::\s*[A-Za-z_]\w*\s*)?\{/;

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

/** True when the source defines the `mainImage` entry point, in GLSL or Slang. */
export function definesMainImage(code: string): boolean {
  return MAIN_IMAGE_DEFINITION.test(stripCommentsAndStrings(code));
}
