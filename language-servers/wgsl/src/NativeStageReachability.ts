import { getShaderSourceFunctions, tokenizeShaderSource } from "@shader-studio/types";
import type { Position } from "vscode-languageserver-protocol";

/** Whether a position belongs solely to native fragment code in a shared WGSL module. */
export function isFragmentOnlyNativePosition(source: string, position: Position): boolean {
  const functions = getShaderSourceFunctions(source, "wgsl");
  const offset = offsetAt(source, position);
  const owner = functions.find((fn) => offset >= fn.bodyStart && offset <= fn.bodyEnd);
  if (!owner) {
    return false;
  }
  const nonFragmentReachable = reachable(functions, source,
    functions.filter((fn) => fn.stage === "compute" || fn.stage === "vertex").map((fn) => fn.name));
  if (nonFragmentReachable.has(owner.name)) {
    return false;
  }
  const fragmentReachable = reachable(functions, source,
    functions.filter((fn) => fn.stage === "fragment").map((fn) => fn.name));
  return fragmentReachable.has(owner.name);
}

function reachable(functions: ReturnType<typeof getShaderSourceFunctions>, source: string, roots: string[]): Set<string> {
  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const tokens = tokenizeShaderSource(source);
  const seen = new Set(roots);
  const pending = [...roots];
  while (pending.length) {
    const fn = byName.get(pending.pop()!);
    if (!fn) {
      continue;
    }
    for (let index = 0; index < tokens.length - 1; index++) {
      const token = tokens[index]!;
      if (token.start < fn.bodyStart || token.end > fn.bodyEnd || token.kind !== "identifier" || tokens[index + 1]?.text !== "(") {
        continue;
      }
      if (byName.has(token.text) && !seen.has(token.text)) {
        seen.add(token.text);
        pending.push(token.text);
      }
    }
  }
  return seen;
}

function offsetAt(source: string, position: Position): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++) {
    offset = source.indexOf("\n", offset) + 1;
  }
  return offset + position.character;
}
