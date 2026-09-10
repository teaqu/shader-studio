import type { DebugPreviewOptions, DebugSiteAnalysis, DebugSourceEdit } from "@shader-studio/types";
import { applySourceEdits } from "@shader-studio/utils";
import { tokenizeWgsl, type WgslAnalysisDocument } from "@shader-studio/wgsl-analysis";
import { comparePositions, containsRange, offsetAt } from "./model";

export interface WgslBehaviorInstrumentation {
  edits: DebugSourceEdit[];
  declarations: string[];
  setup: string[];
}

/** Mirror the inspector's callable-wide loop ordering and editable parameter list. */
export function buildWgslBehaviorInstrumentation(
  document: WgslAnalysisDocument,
  analysis: DebugSiteAnalysis,
  prefix: string,
  options: DebugPreviewOptions,
): WgslBehaviorInstrumentation | string {
  const result: WgslBehaviorInstrumentation = { edits: [], declarations: [], setup: [] };
  const callable = document.scopes.find(scope => scope.kind === "function"
    && containsRange(scope.range, analysis.containingCallable.signatureRange));
  if (!callable) return result;
  const tokens = tokenizeWgsl(document.source);
  const bodyStart = (range: typeof callable.range) => tokens.find(token => token.text === "{"
    && token.offset >= offsetAt(document.source, range.start)
    && token.offset < offsetAt(document.source, range.end))?.offset;
  const parameters = document.symbols.filter(symbol => symbol.kind === "parameter" && symbol.scopeId === callable.id
    && !/^\s*ptr\s*<\s*function\b/.test(symbol.typeName ?? ""));
  const initializers: string[] = [];
  for (const [index, expression] of [...(options.customParameters ?? [])].sort(([left], [right]) => left - right)) {
    const parameter = parameters[index];
    if (!parameter) continue;
    result.edits.push({ start: offsetAt(document.source, parameter.declaration.start),
      end: offsetAt(document.source, parameter.declaration.end), text: `${prefix}_originalParam${index}` });
    const expressionTokens = tokenizeWgsl(expression);
    const replacements = expressionTokens.flatMap((token, tokenIndex) => token.text === "coord"
      && expressionTokens[tokenIndex - 1]?.text !== "."
      ? [{ start: token.offset, end: token.offset + token.text.length, text: `${prefix}_coord` }] : []);
    const rewritten = applySourceEdits(expression, replacements);
    if (!rewritten.ok) return "WGSL parameter expression edits overlap.";
    initializers.push(`let ${parameter.name}: ${parameter.typeName} = ${rewritten.source};`);
  }
  if (initializers.length > 0) {
    const start = bodyStart(callable.range);
    if (start === undefined) return "The selected WGSL function has no writable body.";
    result.edits.push({ start: start + 1, end: start + 1, text: `\n  ${initializers.join("\n  ")}` });
    result.declarations.push(`var<private> ${prefix}_coord: vec2f;`);
    result.setup.push(`${prefix}_coord = coord;`);
  }
  const loops = document.statements.filter(statement => ["for", "while", "loop"].includes(statement.kind)
    && containsRange(callable.range, statement.range))
    .sort((left, right) => comparePositions(left.range.start, right.range.start));
  for (const [index, loop] of loops.entries()) {
    const cap = options.loopMaxIterations?.get(index);
    if (cap === undefined) continue;
    if (!Number.isFinite(cap)) return "WGSL loop limits must be finite numbers.";
    const start = bodyStart(loop.range);
    if (start === undefined) return "The selected WGSL loop has no writable body.";
    const counter = `${prefix}_loop${index}`;
    const limit = Math.min(0xffffffff, Math.max(0, Math.floor(cap)));
    const loopStart = offsetAt(document.source, loop.range.start);
    result.edits.push({ start: loopStart, end: loopStart, text: `var ${counter}: u32 = 0u;\n  ` });
    result.edits.push({ start: start + 1, end: start + 1,
      text: `\n    if (${counter} >= ${limit}u) { break; }\n    ${counter} += 1u;` });
  }
  return result;
}
