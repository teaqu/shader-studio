import { tokenizeWgsl, type WgslAnalysisDocument } from '@shader-studio/wgsl-analysis';
import { containsRange, offsetAt } from '../wgsl/model';

/** Private invocation bookkeeping never consumes a visible trace record. */
export function planWgslTraceCalls(document: WgslAnalysisDocument, authored: (line: number) => boolean) {
  const tokens = tokenizeWgsl(document.source);
  const functions = document.scopes.filter(scope => scope.kind === 'function' && authored(scope.range.start.line + 1));
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let serial = 0;
  for (const scope of functions) {
    const start = offsetAt(document.source, scope.range.start);
    const end = offsetAt(document.source, scope.range.end);
    const body = tokens.find(token => token.text === '{' && token.offset >= start && token.offset < end);
    if (!body) {
      continue;
    }
    edits.push({ start: body.offset + 1, end: body.offset + 1, text: '\n  _ss_trace_enter();\n' });
    const symbol = document.symbols.find(item => item.kind === 'function' && item.name === scope.name);
    const returns = document.statements.filter(statement => statement.kind === 'return' && containsRange(scope.range, statement.range));
    for (const statement of returns) {
      const returnStart = offsetAt(document.source, statement.range.start);
      const returnEnd = offsetAt(document.source, statement.range.end);
      const expression = document.source.slice(returnStart, returnEnd).replace(/^return\b/, '').replace(/;\s*$/, '').trim();
      const temporary = `_ss_trace_return${serial++}`;
      edits.push({ start: returnStart, end: returnEnd, text: expression
        ? `let ${temporary}: ${symbol?.typeName} = ${expression}; _ss_trace_exit(); return ${temporary};`
        : '_ss_trace_exit(); return;' });
    }
    const bodyTokens = tokens.filter(token => token.offset > body.offset && token.offset < end - 1);
    const last = bodyTokens[bodyTokens.length - 1];
    // Non-void functions necessarily return. Void fallthrough needs an exit.
    const finalReturn = returns.some(statement => offsetAt(document.source, statement.range.end) === (last ? last.offset + last.text.length : -1));
    if (!symbol?.typeName && !finalReturn) {
      edits.push({ start: end - 1, end: end - 1, text: '\n  _ss_trace_exit();\n' });
    }
  }
  return { edits, stackSize: Math.max(1, functions.length) };
}
