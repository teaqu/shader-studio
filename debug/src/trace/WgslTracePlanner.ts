import { parseWgslDocument, tokenizeWgsl, type WgslAnalysisDocument, type WgslStatement } from '@shader-studio/wgsl-analysis';
import { applySourceEdits } from '@shader-studio/utils/source-edits';
import type { WgslTraceLaunch, WgslTracePlan, WgslTraceSite, WgslTraceVariable } from '@shader-studio/types';
import { validateWgslTraceLaunch, WGSL_TRACE_UNIFORM_TYPES } from '@shader-studio/types';
import { containsPosition, containsRange, offsetAt } from '../wgsl/model';

const PREFIX = '_ss_trace_';
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'loop']);

function validateBracedControls(tokens: ReturnType<typeof tokenizeWgsl>, start: number, end: number): void {
  for (const [index, token] of tokens.entries()) {
    if (token.offset < start || token.offset >= end) {
      continue;
    }
    if (!CONTROL.has(token.text)) {
      continue;
    }
    let parentheses = 0;
    let braced = false;
    for (const next of tokens.slice(index + 1)) {
      parentheses += next.text === '(' ? 1 : next.text === ')' ? -1 : 0;
      if (parentheses === 0 && ['{', ';', '}'].includes(next.text)) {
        braced = next.text === '{';
        break;
      }
    }
    if (!braced) {
      throw new Error('The trace PoC requires braced control-flow bodies.');
    }
  }
}

function localsBefore(document: WgslAnalysisDocument, statement: WgslStatement) {
  const start = offsetAt(document.source, statement.range.start);
  const scopes = new Set(document.scopes.filter(scope => scope.kind !== 'global'
    && containsPosition(scope.range, statement.range.start)).map(scope => scope.id));
  const tokens = tokenizeWgsl(document.source);
  const loopHeaders = document.statements.filter(item => item.kind === 'for').map(loop => ({
    loop, start: offsetAt(document.source, loop.range.start),
    end: tokens.find(token => token.text === '{' && token.offset >= offsetAt(document.source, loop.range.start))?.offset ?? 0,
  }));
  const visible = document.symbols.filter(value => scopes.has(value.scopeId)
    && ['variable', 'parameter', 'constant'].includes(value.kind)
    && offsetAt(document.source, value.declaration.start) < start
    // The analysis parser puts for-header variables in the containing scope.
    // Apply their actual lifetime locally without changing the inspector parser.
    && loopHeaders.every(header => {
      const declaration = offsetAt(document.source, value.declaration.start);
      return declaration < header.start || declaration >= header.end || containsPosition(header.loop.range, statement.range.start);
    }))
    .sort((left, right) => offsetAt(document.source, right.declaration.start) - offsetAt(document.source, left.declaration.start));
  const names = new Set<string>();
  return visible.filter(value => {
    if (names.has(value.name)) {
      return false;
    }
    names.add(value.name);
    return true;
  });
}

export function traceVariable(name: string, type: string): WgslTraceVariable | undefined {
  if (['f32', 'i32', 'u32', 'bool'].includes(type)) {
    return { name, type, component: type as WgslTraceVariable['component'], width: 1 };
  }
  const vector = /^vec([234])(?:([fiu])|<\s*(f32|i32|u32)\s*>)$/.exec(type);
  if (!vector) {
    return undefined;
  }
  const component = vector[3] ?? ({ f: 'f32', i: 'i32', u: 'u32' }[vector[2]]);
  return { name, type, component: component as WgslTraceVariable['component'], width: Number(vector[1]) };
}

function analyseTraceEntry(launch: WgslTraceLaunch) {
  const tokens = tokenizeWgsl(launch.source);
  if (tokens.some(token => token.text.startsWith(PREFIX))
    || tokens.some((token, index) => token.text === '@' && ['group', 'binding', 'compute', 'vertex', 'fragment'].includes(tokens[index + 1]?.text))) {
    throw new Error('The trace PoC requires a mainImage shader without authored GPU bindings/entry points or reserved _ss_trace_ names.');
  }
  const customUniforms = new Map((launch.customUniforms ?? []).map(uniform => [uniform.name, WGSL_TRACE_UNIFORM_TYPES[uniform.type]]));
  const document = parseWgslDocument(launch.path, launch.source, 'fragment', { valueType: name => customUniforms.get(name) });
  if (!document.parsedSuccessfully) {
    throw new Error(`Cannot plan WGSL trace: ${document.diagnostics.map(item => item.message).join('; ')}`);
  }
  const globalScope = document.scopes.find(scope => scope.kind === 'global')!;
  const collision = document.symbols.find(symbol => symbol.scopeId === globalScope.id && customUniforms.has(symbol.name));
  if (collision) {
    throw new Error(`Trace custom uniform '${collision.name}' conflicts with an authored global declaration.`);
  }
  const entry = document.scopes.find(scope => scope.kind === 'function' && scope.name === 'mainImage');
  const symbol = document.symbols.find(item => item.kind === 'function' && item.name === 'mainImage');
  const parameters = document.symbols.filter(item => item.kind === 'parameter' && item.scopeId === entry?.id);
  const coordinate = parameters[0];
  if (!entry || !symbol || parameters.length !== 1 || !/^vec2(?:f|<\s*f32\s*>)$/.test(coordinate.typeName ?? '')
    || !/^vec4(?:f|<\s*f32\s*>)$/.test(symbol.typeName ?? '')) {
    throw new Error('The trace PoC requires fn mainImage(coord: vec2f) -> vec4f.');
  }
  const body = tokens.find(token => token.text === '{' && token.offset > offsetAt(launch.source, symbol.declaration.end));
  if (!body) {
    throw new Error('mainImage has no body.');
  }
  validateBracedControls(tokens, body.offset, offsetAt(launch.source, entry.range.end));
  return { tokens, document, entry, coordinate, body };
}

/** A new planner: never calls or alters the snapshot instrumentation engine. */
export function planWgslTrace(launch: WgslTraceLaunch): WgslTracePlan {
  validateWgslTraceLaunch(launch);
  const { tokens, document, entry, coordinate, body } = analyseTraceEntry(launch);
  const sites: WgslTraceSite[] = [];
  const edits = [{ start: body.offset + 1, end: body.offset + 1,
    text: `\n  ${PREFIX}enabled = all(${coordinate.name} == ${PREFIX}u.pixel);\n` }];
  for (const statement of document.statements) {
    if (!containsRange(entry.range, statement.range) || ['block', 'const_assert'].includes(statement.kind)) {
      continue;
    }
    const start = offsetAt(launch.source, statement.range.start);
    // For-header declarations/updates are expressions, not standalone sites.
    const insideHeader = document.statements.some(parent => CONTROL.has(parent.kind)
      && parent !== statement && containsRange(parent.range, statement.range)
      && (tokens.find(token => token.text === '{' && token.offset >= offsetAt(launch.source, parent.range.start))?.offset ?? 0) > start);
    if (insideHeader) {
      continue;
    }
    const locals = localsBefore(document, statement);
    const variables = locals.map(value => traceVariable(value.name, value.typeName ?? ''))
      .filter((value): value is WgslTraceVariable => value !== undefined);
    const unavailableVariables = locals.filter(value => !traceVariable(value.name, value.typeName ?? ''))
      .map(value => ({ name: value.name, type: value.typeName ?? 'unresolved' }));
    const site: WgslTraceSite = { id: sites.length, line: statement.range.start.line + 1,
      column: statement.range.start.character + 1, variables, ...(unavailableVariables.length ? { unavailableVariables } : {}) };
    sites.push(site);
    edits.push({ start, end: start, text: `\n  ${PREFIX}site${site.id}(${site.variables.map(value => value.name).join(', ')});\n  ` });
  }
  if (sites.length === 0) {
    throw new Error('mainImage contains no traceable statements.');
  }
  const applied = applySourceEdits(launch.source, edits);
  if (!applied.ok) {
    throw new Error('WGSL trace instrumentation overlaps.');
  }
  return { source: applied.source, sites, capacity: launch.capacity,
    recordWords: 4 + Math.max(1, ...sites.map(site => site.variables.length)) * 4 };
}

function packedVariable(variable: WgslTraceVariable): string {
  const lanes = Array.from({ length: 4 }, (_, index) => {
    if (index >= variable.width) {
      return '0u';
    }
    const expression = variable.width === 1 ? variable.name : `${variable.name}[${index}]`;
    if (variable.component === 'bool') {
      return `select(0u, 1u, ${expression})`;
    }
    return variable.component === 'u32' ? expression : `bitcast<u32>(${expression})`;
  });
  return `vec4u(${lanes.join(', ')})`;
}

/** Dedicated group 1 is safe because this PoC rejects authored bindings. */
export function emitWgslTracePrelude(plan: WgslTracePlan): string {
  const maxValues = (plan.recordWords - 4) / 4;
  // Program traces allocate their own group after the production wrapper's
  // bindings. Keep the single-file PoC on its historical group 1.
  const bindingGroup = plan.bindingGroup ?? 1;
  return `
struct ${PREFIX}Uniforms { pixel: vec2f, _pad: vec2u }
struct ${PREFIX}Record { site: vec4u, values: array<vec4u, ${maxValues}> }
struct ${PREFIX}Buffer { count: atomic<u32>, overflow: atomic<u32>, _pad: vec2u, records: array<${PREFIX}Record> }
@group(${bindingGroup}) @binding(0) var<uniform> ${PREFIX}u: ${PREFIX}Uniforms;
@group(${bindingGroup}) @binding(1) var<storage, read_write> ${PREFIX}buffer: ${PREFIX}Buffer;
var<private> ${PREFIX}enabled: bool;
var<private> ${PREFIX}full: bool;
${plan.sites.map(site => `
fn ${PREFIX}site${site.id}(${site.variables.map(value => `${value.name}: ${value.type}`).join(', ')}) {
  if (!${PREFIX}enabled || ${PREFIX}full) { return; }
  let ${PREFIX}index = atomicAdd(&${PREFIX}buffer.count, 1u);
  if (${PREFIX}index >= ${plan.capacity}u) {
    atomicStore(&${PREFIX}buffer.overflow, 1u);
    ${PREFIX}full = true;
    return;
  }
  ${PREFIX}buffer.records[${PREFIX}index].site = vec4u(${site.id}u, 0u, 0u, 0u);
${site.variables.map((value, index) => `  ${PREFIX}buffer.records[${PREFIX}index].values[${index}] = ${packedVariable(value)};`).join('\n')}
}`).join('\n')}`;
}
