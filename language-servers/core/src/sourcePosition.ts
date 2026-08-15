import type { Position } from "vscode-languageserver-protocol";

export function isPositionInComment(source: string, position: Position): boolean {
  const lines = source.split("\n");
  if (position.line < 0 || position.line >= lines.length || position.character < 0) {
    return false;
  }
  const target = lines.slice(0, position.line).reduce((offset, line) => offset + line.length + 1, 0)
    + Math.min(position.character, lines[position.line]?.length ?? 0);
  let lineComment = false;
  let blockDepth = 0;
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < target; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockDepth > 0) {
      if (character === "/" && next === "*") {
        blockDepth++;
        index++;
      } else if (character === "*" && next === "/") {
        blockDepth--;
        index++;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "/" && next === "/") {
      lineComment = true;
      index++;
    } else if (character === "/" && next === "*") {
      blockDepth = 1;
      index++;
    }
  }
  return lineComment || blockDepth > 0;
}
