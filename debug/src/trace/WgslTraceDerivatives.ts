import { resolveWgslExpressionType, tokenizeWgsl, type WgslAnalysisDocument, type WgslExpressionContext } from '@shader-studio/wgsl-analysis';
import { applySourceEdits } from '@shader-studio/utils';

const WIDTHS = new Map([['fwidth', ''], ['fwidthFine', 'Fine'], ['fwidthCoarse', 'Coarse']]);

function widthCalls(source: string) {
  const tokens = tokenizeWgsl(source);
  return tokens.flatMap((token, index) => {
    if (!WIDTHS.has(token.text) || tokens[index + 1]?.text !== '(' || ['fn', '.'].includes(tokens[index - 1]?.text ?? '')) {
      return [];
    }
    let depth = 0;
    for (let end = index + 1; end < tokens.length; end += 1) {
      depth += tokens[end]!.text === '(' ? 1 : tokens[end]!.text === ')' ? -1 : 0;
      if (depth === 0) {
        return [{ token, argument: source.slice(tokens[index + 1]!.offset + 1, tokens[end]!.offset) }];
      }
    }
    return [];
  });
}

/**
 * Keep derivative width on its specified abs(dpdx(x)) + abs(dpdy(x)) path.
 * Some traced shader compilations lose fwidth after storage-writing hooks,
 * although the individual derivatives remain correct. Typed helpers evaluate
 * the argument once and preserve fine/coarse selection.
 *
 * Match calls after return rewriting so nested source edits never overlap and
 * the original authored site positions stay intact.
 */
export function normalizeWgslTraceDerivatives(
  document: WgslAnalysisDocument,
  instrumented: string,
  authored: (line: number) => boolean = () => true,
  context: WgslExpressionContext = {},
): string {
  const shadowed = new Set(document.symbols.filter(symbol => symbol.kind === 'function').map(symbol => symbol.name));
  const original = widthCalls(document.source);
  const helpers = new Map<string, string>();
  const names = original.map(({ token, argument }) => {
    if (!authored(token.line + 1) || shadowed.has(token.text)) {
      return undefined;
    }
    const type = resolveWgslExpressionType({ uri: document.uri, source: document.source, stage: document.stage,
      position: { line: token.line, character: token.character }, expression: argument }, context)?.name;
    if (!type || !/^(?:f32|f16|vec[234](?:[fh]|<\s*f(?:32|16)\s*>))$/.test(type)) {
      return undefined;
    }
    const name = `_ss_trace_${token.text}_${type.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const suffix = WIDTHS.get(token.text)!;
    helpers.set(name, `fn ${name}(x: ${type}) -> ${type} { return abs(dpdx${suffix}(x)) + abs(dpdy${suffix}(x)); }`);
    return name;
  });
  if (helpers.size === 0) {
    return instrumented;
  }
  const calls = widthCalls(instrumented);
  if (calls.length !== original.length || calls.some((call, index) => call.token.text !== original[index]!.token.text)) {
    throw new Error('WGSL trace instrumentation changed derivative call order.');
  }
  const edits = calls.flatMap(({ token }, index) => names[index]
    ? [{ start: token.offset, end: token.offset + token.text.length, text: names[index]! }] : []);
  const applied = applySourceEdits(instrumented, edits);
  if (!applied.ok) {
    throw new Error('WGSL trace derivative instrumentation overlaps.');
  }
  return `${applied.source}\n${[...helpers.values()].join('\n')}\n`;
}
