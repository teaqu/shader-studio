import { getShaderSourceFunctions, tokenizeShaderSource } from "./ShaderEntryPoints";
import type { ShaderLanguageId } from "./shader-environment/ShaderLanguages";

/** Keep selected stages and reachable helpers, including overloads and global initializers.
 * Blank omitted functions rather than deleting lines so driver diagnostics retain source positions. */
export function isolateShaderEntryPoints(
  source: string,
  language: ShaderLanguageId,
  selected: readonly string[],
  externalSources: readonly string[] = [],
): string {
  const functions = getShaderSourceFunctions(source, language);
  if (!functions.length) {
    return source;
  }
  const byName = new Map<string, typeof functions>();
  for (const fn of functions) {
    byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn]);
  }
  const tokens = tokenizeShaderSource(source);
  const keep = new Set(selected);
  const pending = [...selected];
  const retainReferences = (scopeTokens: typeof tokens) => {
    for (let index = 0; index < scopeTokens.length; index++) {
      const token = scopeTokens[index]!;
      if (token.kind !== "identifier" || !byName.has(token.text) || keep.has(token.text)) {
        continue;
      }
      keep.add(token.text);
      pending.push(token.text);
    }
  };
  // Globals, struct methods and common/imported source can reference root helpers.
  retainReferences(tokens.filter(token => !functions.some(fn => token.start >= fn.start && token.end <= fn.end)));
  for (const external of externalSources) {
    retainReferences(tokenizeShaderSource(external));
  }
  while (pending.length) {
    for (const fn of byName.get(pending.pop()!) ?? []) {
      retainReferences(tokens.filter(token => token.start >= fn.start && token.end <= fn.end));
    }
  }
  const output = source.split("");
  for (const fn of functions) {
    if (keep.has(fn.name)) {
      continue;
    }
    for (let index = fn.start; index < fn.end; index++) {
      if (output[index] !== "\n" && output[index] !== "\r") {
        output[index] = " ";
      }
    }
  }
  return output.join("");
}
