import { parseWgslDocument, tokenizeWgsl, type WgslAnalysisDocument, type WgslStatement } from '@shader-studio/wgsl-analysis';
import { applySourceEdits } from '@shader-studio/utils/source-edits';
import type { WgslTracePlan, WgslTraceSite } from '@shader-studio/types';
import { containsPosition, offsetAt } from '../wgsl/model';
import { planWgslTraceValues } from './WgslTraceAggregate';
import { planWgslTraceCalls } from './WgslTraceCalls';

const PREFIX = '_ss_trace_';
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'loop']);

export interface WgslTraceProgramRange {
  path: string;
  /** One-based inclusive assembled-module lines belonging to an authored file. */
  startLine: number;
  endLine: number;
}

export interface WgslTraceProgramRequest {
  source: string;
  entryPoint: string;
  stage: 'fragment' | 'compute' | 'vertex';
  /** Extra generated fragment selector, e.g. the visible mesh primitive ID. */
  fragmentPredicate?: string;
  capacity: number;
  sourceRanges: WgslTraceProgramRange[];
}

/** Extra source identity is deliberately structural until the public trace types grow it. */
export interface WgslTraceProgramSite extends WgslTraceSite {
  path: string;
  functionName: string;
}

export interface WgslTraceProgramPlan extends WgslTracePlan {
  sites: WgslTraceProgramSite[];
  bindingGroup: number;
}

function localValuesBefore(document: WgslAnalysisDocument, statement: WgslStatement) {
  const start = offsetAt(document.source, statement.range.start);
  const scopes = new Set(document.scopes.filter(scope => scope.kind !== 'global'
    && containsPosition(scope.range, statement.range.start)).map(scope => scope.id));
  const tokens = tokenizeWgsl(document.source);
  const loopHeaders = document.statements.filter(item => item.kind === 'for').map(loop => ({
    loop,
    start: offsetAt(document.source, loop.range.start),
    end: tokens.find(token => token.text === '{' && token.offset >= offsetAt(document.source, loop.range.start))?.offset ?? 0,
  }));
  const visible = document.symbols.filter(value => scopes.has(value.scopeId)
    && ['variable', 'parameter', 'constant'].includes(value.kind)
    && offsetAt(document.source, value.declaration.start) < start
    // The shared parser describes for-header variables in the surrounding
    // scope. Restrict their lifetime here without changing inspector analysis.
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

function sourceRangeAt(ranges: readonly WgslTraceProgramRange[], line: number): WgslTraceProgramRange | undefined {
  return ranges.find(range => range.startLine <= line && line <= range.endLine);
}

function callableAt(document: WgslAnalysisDocument, scopeId: string): string | undefined {
  let scope = document.scopes.find(item => item.id === scopeId);
  while (scope) {
    if (scope.kind === 'function') {
      return scope.name;
    }
    scope = scope.parentId === undefined ? undefined : document.scopes.find(item => item.id === scope!.parentId);
  }
  return undefined;
}

function scanBindingGroup(tokens: ReturnType<typeof tokenizeWgsl>): number {
  let maximum = -1;
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    if (tokens[index]?.text !== '@' || tokens[index + 1]?.text !== 'group' || tokens[index + 2]?.text !== '(') {
      continue;
    }
    const value = Number(tokens[index + 3]?.text);
    if (Number.isInteger(value)) {
      maximum = Math.max(maximum, value);
    }
  }
  return maximum + 1;
}

interface EntryLocation {
  body: number;
  closeParameters: number;
  parameterStart: number;
  parameterEnd: number;
}

function entryLocation(tokens: ReturnType<typeof tokenizeWgsl>, entryPoint: string): EntryLocation {
  const fn = tokens.findIndex((token, index) => token.text === 'fn' && tokens[index + 1]?.text === entryPoint);
  if (fn < 0) {
    throw new Error(`WGSL trace entry '${entryPoint}' was not found.`);
  }
  const open = tokens.findIndex((token, index) => index > fn && token.text === '(');
  if (open < 0) {
    throw new Error(`WGSL trace entry '${entryPoint}' has no parameter list.`);
  }
  let depth = 0;
  let close = -1;
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index]?.text === '(') {
      depth += 1;
    }
    if (tokens[index]?.text === ')' && --depth === 0) {
      close = index;
      break;
    }
  }
  const body = tokens.findIndex((token, index) => index > close && token.text === '{');
  if (close < 0 || body < 0) {
    throw new Error(`WGSL trace entry '${entryPoint}' has no body.`);
  }
  return { body: tokens[body]!.offset, closeParameters: tokens[close]!.offset, parameterStart: open + 1, parameterEnd: close };
}

function builtinParameter(tokens: ReturnType<typeof tokenizeWgsl>, location: EntryLocation, builtin: string): string | undefined {
  for (let index = location.parameterStart; index < location.parameterEnd; index += 1) {
    if (tokens[index]?.text !== '@' || tokens[index + 1]?.text !== 'builtin' || tokens[index + 2]?.text !== '(' || tokens[index + 3]?.text !== builtin || tokens[index + 4]?.text !== ')') {
      continue;
    }
    const name = tokens[index + 5];
    if (name?.kind === 'identifier' && tokens[index + 6]?.text === ':') {
      return name.text;
    }
  }
  return undefined;
}

function entryGate(source: string, tokens: ReturnType<typeof tokenizeWgsl>, request: WgslTraceProgramRequest) {
  const location = entryLocation(tokens, request.entryPoint);
  const builtin = request.stage === 'fragment' ? 'position' : request.stage === 'compute' ? 'global_invocation_id' : 'vertex_index';
  const generatedName = request.stage === 'fragment' ? `${PREFIX}position`
    : request.stage === 'compute' ? `${PREFIX}gid` : `${PREFIX}vertex`;
  const existing = builtinParameter(tokens, location, builtin);
  const parameter = existing ? '' : `${location.parameterStart === location.parameterEnd ? '' : ', '}`
    + `@builtin(${builtin}) ${generatedName}: ${request.stage === 'fragment' ? 'vec4f' : request.stage === 'compute' ? 'vec3u' : 'u32'}`;
  const value = existing ?? generatedName;
  const enable = request.stage === 'fragment'
    ? `all(floor(${value}.xy) == ${PREFIX}u.pixel)${request.fragmentPredicate ? ` && (${request.fragmentPredicate})` : ''}`
    : request.stage === 'compute'
      ? `all(${value} == vec3u(u32(${PREFIX}u.pixel.x), u32(${PREFIX}u.pixel.y), ${PREFIX}u._pad.x))`
      : `${value} == u32(${PREFIX}u.pixel.x)`;
  return {
    edits: [
      ...(parameter ? [{ start: location.closeParameters, end: location.closeParameters, text: parameter }] : []),
      { start: location.body + 1, end: location.body + 1, text: `\n  ${PREFIX}enabled = ${enable};\n` },
    ],
  };
}

/**
 * Instruments the authored regions of a fully production-wrapped WGSL module.
 * This intentionally shares no code path with snapshot instrumentation.
 */
export function planWgslTraceProgram(request: WgslTraceProgramRequest): WgslTraceProgramPlan {
  if (!Number.isInteger(request.capacity) || request.capacity < 1 || request.capacity > 16384) {
    throw new Error('WGSL trace capacity must be an integer from 1 to 16384.');
  }
  if (request.sourceRanges.some(range => !range.path || range.startLine < 1 || range.endLine < range.startLine)) {
    throw new Error('WGSL trace source ranges must be non-empty one-based line ranges.');
  }
  const tokens = tokenizeWgsl(request.source);
  const authored = request.sourceRanges.some(range => {
    const start = range.startLine - 1;
    const end = range.endLine - 1;
    return tokens.some(token => token.line >= start && token.line <= end && token.text.startsWith(PREFIX));
  });
  if (authored) {
    throw new Error(`WGSL trace identifier prefix '${PREFIX}' conflicts with authored source.`);
  }
  const document = parseWgslDocument('/shader-studio/trace-program.wgsl', request.source, request.stage);
  if (!document.parsedSuccessfully) {
    throw new Error(`Cannot plan WGSL trace: ${document.diagnostics.map(item => item.message).join('; ')}`);
  }
  const sites: WgslTraceProgramSite[] = [];
  const edits = [...entryGate(request.source, tokens, request).edits];
  for (const statement of document.statements) {
    if (['block', 'const_assert'].includes(statement.kind)) {
      continue;
    }
    const assembledLine = statement.range.start.line + 1;
    const range = sourceRangeAt(request.sourceRanges, assembledLine);
    const functionName = callableAt(document, statement.scopeId);
    if (!range || !functionName) {
      continue;
    }
    const start = offsetAt(request.source, statement.range.start);
    const insideHeader = document.statements.some(parent => CONTROL.has(parent.kind) && parent !== statement
      && parent.range.start.line <= statement.range.start.line && statement.range.end.line <= parent.range.end.line
      && (tokens.find(token => token.text === '{' && token.offset >= offsetAt(request.source, parent.range.start))?.offset ?? 0) > start);
    if (insideHeader) {
      continue;
    }
    const locals = localValuesBefore(document, statement);
    const { variables, valueShapes, unavailableVariables } = planWgslTraceValues(document, locals);
    const site: WgslTraceProgramSite = {
      id: sites.length,
      path: range.path,
      functionName,
      line: assembledLine - range.startLine + 1,
      column: statement.range.start.character + 1,
      variables,
      valueShapes,
      ...(unavailableVariables.length ? { unavailableVariables } : {}),
    };
    sites.push(site);
    edits.push({ start, end: start, text: `\n  ${PREFIX}site${site.id}(${variables.map(value => value.name).join(', ')});\n  ` });
  }
  if (sites.length === 0) {
    throw new Error('WGSL trace contains no statements in authored source ranges.');
  }
  const calls = planWgslTraceCalls(document, line => sourceRangeAt(request.sourceRanges, line) !== undefined);
  edits.push(...calls.edits);
  const applied = applySourceEdits(request.source, edits);
  if (!applied.ok) {
    throw new Error('WGSL trace instrumentation overlaps.');
  }
  return {
    source: applied.source,
    stackSize: calls.stackSize,
    sites,
    capacity: request.capacity,
    recordWords: 4 + Math.max(1, ...sites.map(site => site.variables.length)) * 4,
    bindingGroup: scanBindingGroup(tokens),
  };
}
