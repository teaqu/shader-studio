export interface CompilerDiagnostic {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
}
interface DiagnosticDocument { getLineCount(): number; getLineMaxColumn(line: number): number; }

/** Renderer errors use authored lines across GLSL, WGSL, and Slang. */
export function compilerDiagnostics(errs: readonly string[], activeBufferName: string, model: DiagnosticDocument): CompilerDiagnostic[] {
  const activeBufferKey = activeBufferName.trim().toLowerCase();
  const markers: CompilerDiagnostic[] = [];

  for (const err of errs) {
    const match = err.match(/^(?:(.+?):\s*)?ERROR:\s*\d+:(\d+):\s*(.+)$/s);
    if (match) {
      const [, passName, lineNumber, diagnostic] = match;
      if (passName && passName.trim().toLowerCase() !== activeBufferKey) {
        continue;
      }

      // Errors can outlive the source that produced them, so clamp to the
      // model's own range: Monaco throws on a line it does not have.
      const line = Math.min(Math.max(1, parseInt(lineNumber, 10)), model.getLineCount());
      const message = diagnostic.trim();
      markers.push({

        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
        message,
      });
      continue;
    }

    // The WGSL renderer maps browser-compiler errors to authored lines itself.
    // `internal:` errors point into generated code, so they have no marker.
    const wgsl = err.match(/^([^:\n]+):\s*WGSL L(\d+):(\d+)\s+(.+)$/s);
    if (wgsl) {
      const [, wgslPassName, lineNumber, columnNumber, diagnostic] = wgsl;
      if (wgslPassName.trim().toLowerCase() !== activeBufferKey) {
        continue;
      }
      const line = Math.min(Math.max(1, Number(lineNumber)), model.getLineCount());
      const maxColumn = model.getLineMaxColumn(line);
      markers.push({

        startLineNumber: line,
        startColumn: Math.min(Math.max(1, Number(columnNumber)), maxColumn),
        endLineNumber: line,
        endColumn: maxColumn,
        message: diagnostic.trim(),
      });
      continue;
    }

    const passName = err.match(/^([^:\n]+):\s*(?=error(?:\[[^\]]+\])?:)/i)?.[1];
    if (passName && passName.trim().toLowerCase() !== activeBufferKey) {
      continue;
    }
    const headings = [...err.matchAll(/(?:^|\n)(?:[^:\n]+:\s*)?error(?:\[[^\]]+\])?:\s*([^\n]+)/gi)];
    for (let index = 0; index < headings.length; index++) {
      const heading = headings[index];
      const nextHeading = headings[index + 1];
      const blockStart = (heading.index ?? 0) + heading[0].length;
      const blockEnd = nextHeading?.index ?? err.length;
      const location = err.slice(blockStart, blockEnd).match(/^\s*-->\s+.+?:(\d+):(\d+)\s*$/m);
      if (!location) {
        continue;
      }
      const line = Math.min(Math.max(1, Number(location[1])), model.getLineCount());
      const maxColumn = model.getLineMaxColumn(line);
      const column = Math.min(Math.max(1, Number(location[2])), maxColumn);
      markers.push({

        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: maxColumn,
        message: heading[1]?.trim() ?? "Slang compiler error",
      });
    }
  }

  return markers;
}
