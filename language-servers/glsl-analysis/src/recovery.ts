import type { ShaderStage } from "@shader-studio/types";
import type { Position } from "vscode-languageserver-protocol";
import type { GlslAnalysisDocument } from "./model.js";
import { parseGlslDocument } from "./parseGlslDocument.js";

/**
 * Parses the document with the statement under the cursor blanked out. A statement being
 * typed is rarely valid GLSL, and a parse failure loses every symbol in the document, so
 * recovering this way keeps declarations that precede the cursor available.
 */
export function parseGlslDocumentAtPosition(
  uri: string,
  source: string,
  stage: ShaderStage,
  position: Position,
): GlslAnalysisDocument {
  return parseGlslDocument(uri, blankStatementAt(source, position), stage);
}

/**
 * Replaces the statement under the cursor with blanks, keeping every line and column
 * in place so an unfinished statement cannot stop the rest of the document parsing.
 */
export function blankStatementAt(source: string, position: Position): string {
  const offset = positionOffset(source, position);
  if (offset === undefined) {
    return source;
  }
  const boundaries = [";", "{", "}"];
  let start = 0;
  for (let index = offset - 1; index >= 0; index--) {
    if (boundaries.includes(source[index] ?? "")) {
      start = index + 1;
      break;
    }
  }
  let end = source.length;
  for (let index = offset; index < source.length; index++) {
    if (boundaries.includes(source[index] ?? "")) {
      end = index;
      break;
    }
  }
  const blanked = source.slice(start, end).replace(/[^\n]/g, " ");
  return `${source.slice(0, start)}${blanked}${source.slice(end)}`;
}

export function positionOffset(source: string, position: Position): number | undefined {
  const lines = source.split("\n");
  const line = lines[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  return lines.slice(0, position.line).reduce((offset, current) => offset + current.length + 1, 0) + position.character;
}
