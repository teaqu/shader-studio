import type { DebugSiteAnalysis, DebugSourcePosition, DebugSourceRange, DebugSourceUnit, DebugWorkspace } from "@shader-studio/types";
import { canonicalizeWgslUri } from "./WgslWorkspace";

export interface WgslDebugSegment {
  file: DebugSourceUnit;
  start: number;
  end: number;
  lineOffset: number;
}

/** Common precedes the pass, as in WgslCompiler. Keep original identities for host routing. */
export class WgslDebugSourceMap {
  readonly segments: WgslDebugSegment[];
  readonly source: string;
  constructor(readonly workspace: DebugWorkspace) {
    const root = canonicalizeWgslUri(workspace.rootUri);
    const ordered = [
      ...workspace.files.filter(file => canonicalizeWgslUri(file.uri) !== root),
      ...workspace.files.filter(file => canonicalizeWgslUri(file.uri) === root),
    ];
    let source = "";
    let lineOffset = 0;
    this.segments = ordered.map(file => {
      const segment = { file, start: source.length, end: source.length + file.source.length, lineOffset };
      source += `${file.source}\n`;
      lineOffset += file.source.split("\n").length;
      return segment;
    });
    this.source = source.slice(0, -1);
  }

  segment(uri: string): WgslDebugSegment {
    return this.segments.find(segment => canonicalizeWgslUri(segment.file.uri) === canonicalizeWgslUri(uri))!;
  }

  assembledPosition(uri: string, position: DebugSourcePosition): DebugSourcePosition {
    return { ...position, line: position.line + this.segment(uri).lineOffset };
  }

  originalRange(range: DebugSourceRange): { sourceUri: string; range: DebugSourceRange } {
    const segment = [...this.segments].reverse().find(segment => segment.lineOffset <= range.start.line)!;
    return { sourceUri: segment.file.uri, range: {
      start: { ...range.start, line: range.start.line - segment.lineOffset },
      end: { ...range.end, line: range.end.line - segment.lineOffset },
    } };
  }

  originalAnalysis(analysis: DebugSiteAnalysis): DebugSiteAnalysis {
    const map = (range: DebugSourceRange) => this.originalRange(range).range;
    return {
      ...analysis,
      sourceUri: this.originalRange(analysis.selectedRange).sourceUri,
      selectedRange: map(analysis.selectedRange),
      statementRange: map(analysis.statementRange),
      containingCallable: { ...analysis.containingCallable,
        signatureRange: map(analysis.containingCallable.signatureRange), bodyRange: map(analysis.containingCallable.bodyRange) },
      visibleValues: analysis.visibleValues.map(value => ({ ...value,
        sourceUri: this.originalRange(value.declarationRange).sourceUri, declarationRange: map(value.declarationRange) })),
      controlFlow: analysis.controlFlow.map(control => ({ ...control, range: map(control.range) })),
      origin: { ...analysis.origin, writableRange: analysis.origin.writableRange && map(analysis.origin.writableRange) },
    };
  }
}
