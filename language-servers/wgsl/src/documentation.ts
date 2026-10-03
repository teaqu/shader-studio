import type { WgslAnalysisDocument, WgslSymbol } from "@shader-studio/wgsl-analysis";

/** A declaration's leading `//` comment, when it has one, above where it came from. */
export function declarationDocumentation(analysis: WgslAnalysisDocument, symbol: WgslSymbol, provenance: string): string {
  const comment = leadingComment(analysis.source, symbol.declaration.start.line);
  return [comment, provenance].filter(Boolean).join("\n\n");
}

/** Contiguous `//` lines directly above a declaration, skipping its attribute lines. */
function leadingComment(source: string, declarationLine: number): string | undefined {
  const lines = source.split(/\r?\n/);
  let line = declarationLine - 1;
  while (line >= 0 && /^\s*@/.test(lines[line] ?? "")) {
    line -= 1;
  }
  const comments: string[] = [];
  for (; line >= 0; line--) {
    const match = /^\s*\/\/+\s?(.*)$/.exec(lines[line] ?? "");
    if (!match) {
      break;
    }
    comments.unshift(match[1]!.trimEnd());
  }
  return comments.length > 0 ? comments.join("\n") : undefined;
}
