import type { StorageBindingNode } from "../types/PassGraph";

/** Ignore trivia without evaluating macros or choosing preprocessor branches.
 * Block comments may nest in WGSL. Quotes inside comments are ordinary text.
 */
function sourceIdentifiers(source: string): Set<string> {
  const identifiers = new Set<string>();
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end + 1;
    } else if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth--;
          index += 2;
        } else {
          index++;
        }
      }
    } else if (source[index] === '"' || source[index] === "'") {
      const quote = source[index++];
      while (index < source.length && source[index] !== quote) {
        index += source[index] === "\\" ? 2 : 1;
      }
      index++;
    } else if (source.startsWith("##", index)) {
      identifiers.add("##");
      index += 2;
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
      if (match) {
        identifiers.add(match[0]);
        index += match[0].length;
      } else {
        index++;
      }
    }
  }
  return identifiers;
}

/** Include common/module/vertex source alongside the pass source. References in
 * inactive branches and unused helpers are retained conservatively. Token pasting
 * can manufacture names, so it retains every declaration. Config-owned types
 * must also remain available when a pass uses the type directly.
 */
export function resolvePassStorage(storage: StorageBindingNode[], ...sources: string[]): StorageBindingNode[] {
  const identifiers = sourceIdentifiers(sources.join("\n"));
  return storage.filter(node => identifiers.has("##") || identifiers.has(node.name) ||
    Boolean(node.structDeclarations && identifiers.has(node.elementType)))
    .map((node, binding) => ({ ...node, binding }));
}
