import type { WgslAnalysisDocument, WgslSymbol } from '@shader-studio/wgsl-analysis';
import type { WgslTraceValueShape, WgslTraceVariable } from '@shader-studio/types';

const MAX_DEPTH = 16;
const MAX_LEAVES_PER_VALUE = 256;
const MAX_LEAVES_PER_SITE = 1024;
const SCALARS = new Set(['f32', 'i32', 'u32', 'bool']);

export interface WgslTraceValuePlan {
  variables: WgslTraceVariable[];
  valueShapes: WgslTraceValueShape[];
  unavailableVariables: Array<{ name: string; type: string }>;
}

/**
 * Expands fixed, value-semantic WGSL aggregates into packed trace leaves. A
 * root is all-or-nothing: an unsupported child never yields a partial value.
 */
export function planWgslTraceValues(
  document: WgslAnalysisDocument,
  locals: Array<{ name: string; typeName?: string }>,
): WgslTraceValuePlan {
  const resolver = new AggregateResolver(document);
  const variables: WgslTraceVariable[] = [];
  const valueShapes: WgslTraceValueShape[] = [];
  const unavailableVariables: Array<{ name: string; type: string }> = [];

  for (const local of locals) {
    const type = local.typeName?.trim() || 'unresolved';
    const expanded = resolver.expand(local.name, type);
    if (!expanded || variables.length + expanded.leaves.length > MAX_LEAVES_PER_SITE) {
      unavailableVariables.push({ name: local.name, type });
      continue;
    }
    const start = variables.length;
    variables.push(...expanded.leaves);
    valueShapes.push(assignSlots(expanded.shape, start));
  }
  return { variables, valueShapes, unavailableVariables };
}

interface Expanded {
  leaves: WgslTraceVariable[];
  shape: WgslTraceValueShape;
}

class AggregateResolver {
  private readonly typeSymbols = new Map<string, WgslSymbol>();
  private readonly typeScopes = new Map<string, string>();
  private readonly constants = new Map<string, WgslSymbol>();
  private readonly constantValues = new Map<string, number | undefined>();
  private readonly resolvingConstants = new Set<string>();

  constructor(private readonly document: WgslAnalysisDocument) {
    for (const symbol of document.symbols) {
      if (symbol.kind === 'type') {
        this.typeSymbols.set(symbol.name, symbol);
      }
      if (symbol.kind === 'constant' && this.globalScopeId() === symbol.scopeId) {
        this.constants.set(symbol.name, symbol);
      }
    }
    for (const scope of document.scopes) {
      if (scope.kind === 'type') {
        this.typeScopes.set(scope.name, scope.id);
      }
    }
  }

  expand(name: string, type: string): Expanded | undefined {
    const expanded = this.expandValue(name, type, 0, new Set());
    return expanded && expanded.leaves.length <= MAX_LEAVES_PER_VALUE ? expanded : undefined;
  }

  private expandValue(expression: string, type: string, depth: number, visiting: Set<string>): Expanded | undefined {
    if (depth > MAX_DEPTH) {
      return undefined;
    }
    const resolved = this.resolveAlias(type, visiting);
    if (!resolved || isUnsupportedReferenceType(resolved)) {
      return undefined;
    }
    return this.scalarOrVector(expression, resolved)
      ?? this.matrixValue(expression, resolved)
      ?? this.arrayValue(expression, resolved, depth, visiting)
      ?? this.structValue(expression, resolved, depth, visiting);
  }

  private scalarOrVector(expression: string, type: string): Expanded | undefined {
    const scalar = this.scalarLeaf(expression, type);
    if (scalar) {
      return scalar;
    }
    const vectorType = vector(type);
    if (vectorType && vectorType.componentType !== 'f16' && SCALARS.has(vectorType.componentType)) {
      return leaf(expression, type, vectorType.componentType as WgslTraceVariable['component'], vectorType.size);
    }
    return undefined;
  }

  private matrixValue(expression: string, type: string): Expanded | undefined {
    const value = matrix(type);
    if (!value || value.componentType !== 'f32') {
      return undefined;
    }
    const columnType = `vec${value.rows}f`;
    const leaves = Array.from({ length: value.columns }, (_, column) => leaf(`${expression}[${column}]`, columnType, 'f32', value.rows).leaves[0]!);
    return { leaves, shape: { name: expression, type, children: leaves.map((item, column) => ({ name: `[${column}]`, type: item.type })) } };
  }

  private arrayValue(expression: string, type: string, depth: number, visiting: Set<string>): Expanded | undefined {
    const array = parseArray(type, name => this.constant(name));
    if (!array || array.count === undefined || array.count <= 0 || array.count > MAX_LEAVES_PER_VALUE) {
      return undefined;
    }
    const children: WgslTraceValueShape[] = [];
    const leaves: WgslTraceVariable[] = [];
    for (let index = 0; index < array.count; index += 1) {
      const child = this.expandValue(`${expression}[${index}]`, array.element, depth + 1, new Set(visiting));
      if (!child || leaves.length + child.leaves.length > MAX_LEAVES_PER_VALUE) {
        return undefined;
      }
      children.push(renameShape(child.shape, `[${index}]`));
      leaves.push(...child.leaves);
    }
    return { leaves, shape: { name: expression, type, children } };
  }

  private structValue(expression: string, type: string, depth: number, visiting: Set<string>): Expanded | undefined {
    const scopeId = this.typeScopes.get(type);
    if (!scopeId || visiting.has(type)) {
      return undefined;
    }
    const fields = this.document.symbols.filter(symbol => symbol.kind === 'field' && symbol.scopeId === scopeId && symbol.typeName);
    if (!fields.length) {
      return undefined;
    }
    const nested = new Set(visiting); nested.add(type);
    const children: WgslTraceValueShape[] = [];
    const leaves: WgslTraceVariable[] = [];
    for (const field of fields) {
      const child = this.expandValue(`${expression}.${field.name}`, field.typeName!, depth + 1, nested);
      if (!child || leaves.length + child.leaves.length > MAX_LEAVES_PER_VALUE) {
        return undefined;
      }
      children.push(renameShape(child.shape, field.name));
      leaves.push(...child.leaves);
    }
    return { leaves, shape: { name: expression, type, children } };
  }

  private scalarLeaf(expression: string, type: string): Expanded | undefined {
    return SCALARS.has(type) ? leaf(expression, type, type as WgslTraceVariable['component'], 1) : undefined;
  }

  private resolveAlias(type: string, visiting: Set<string>): string | undefined {
    let current = type.trim();
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const symbol = this.typeSymbols.get(current);
      if (!symbol?.typeName) {
        return current;
      }
      if (visiting.has(current)) {
        return undefined;
      }
      current = symbol.typeName.trim();
    }
    return undefined;
  }

  private constant(name: string): number | undefined {
    const symbol = this.constants.get(name);
    if (!symbol || this.resolvingConstants.has(name)) {
      return undefined;
    }
    if (this.constantValues.has(name)) {
      return this.constantValues.get(name);
    }
    this.resolvingConstants.add(name);
    const start = offset(this.document.source, symbol.declaration.start.line, symbol.declaration.start.character);
    const text = this.document.source.slice(start, this.document.source.indexOf(';', start));
    const equals = text.indexOf('=');
    const result = equals < 0 ? undefined : evaluateInteger(text.slice(equals + 1), other => this.constant(other));
    this.resolvingConstants.delete(name);
    this.constantValues.set(name, result);
    return result;
  }

  private globalScopeId(): string | undefined {
    return this.document.scopes.find(scope => scope.kind === 'global')?.id;
  }
}

function isUnsupportedReferenceType(type: string): boolean {
  return /^ptr\s*</.test(type) || /^atomic\s*</.test(type);
}

function vector(type: string): { componentType: string; size: number } | undefined {
  const match = /^vec([234])(?:([fhiu])|<\s*(bool|i32|u32|f32|f16)\s*>)$/.exec(type.trim());
  if (!match?.[1]) {
    return undefined;
  }
  const component = match[3] ?? ({ f: 'f32', h: 'f16', i: 'i32', u: 'u32' }[match[2] ?? '']);
  return component ? { componentType: component, size: Number(match[1]) } : undefined;
}

function matrix(type: string): { componentType: 'f32' | 'f16'; columns: number; rows: number } | undefined {
  const match = /^mat([234])x([234])(?:([fh])|<\s*(f32|f16)\s*>)$/.exec(type.trim());
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const component = match[4] ?? (match[3] === 'h' ? 'f16' : 'f32');
  return { componentType: component as 'f32' | 'f16', columns: Number(match[1]), rows: Number(match[2]) };
}

function leaf(name: string, type: string, component: WgslTraceVariable['component'], width: number): Expanded {
  return { leaves: [{ name, type, component, width }], shape: { name, type } };
}

function renameShape(shape: WgslTraceValueShape, name: string): WgslTraceValueShape {
  return { ...shape, name };
}

function assignSlots(shape: WgslTraceValueShape, slot: number): WgslTraceValueShape {
  if (!shape.children) {
    return { ...shape, slot };
  }
  let next = slot;
  return { ...shape, children: shape.children.map(child => {
    const assigned = assignSlots(child, next);
    next += leafCount(assigned);
    return assigned;
  }) };
}

function leafCount(shape: WgslTraceValueShape): number {
  return shape.children ? shape.children.reduce((count, child) => count + leafCount(child), 0) : 1;
}

function parseArray(type: string, constant: (name: string) => number | undefined): { element: string; count?: number } | undefined {
  const match = /^array\s*<\s*([\s\S]+)\s*>$/.exec(type);
  if (!match?.[1]) {
    return undefined;
  }
  const parts = splitTopLevel(match[1]);
  if (parts.length < 1 || parts.length > 2) {
    return undefined;
  }
  const count = parts[1] === undefined ? undefined : evaluateInteger(parts[1], constant);
  return { element: parts[0]!.trim(), count };
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []; let depth = 0; let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '<' || text[index] === '(') {
      depth += 1;
    }
    if (text[index] === '>' || text[index] === ')') {
      depth -= 1;
    }
    if (text[index] === ',' && depth === 0) {
      parts.push(text.slice(start, index)); start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Tiny, total evaluator for positive integer array-size expressions. */
function evaluateInteger(text: string, constant: (name: string) => number | undefined): number | undefined {
  const tokens = text.match(/[A-Za-z_]\w*|\d+[u]?|[()+\-*/%]/g);
  if (!tokens || tokens.join('') !== text.replace(/\s+/g, '')) {
    return undefined;
  }
  let index = 0;
  const expression = (): number | undefined => {
    let value = term();
    while (value !== undefined && ['+', '-'].includes(tokens[index] ?? '')) {
      const operator = tokens[index++]!; const right = term();
      value = right === undefined ? undefined : operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const term = (): number | undefined => {
    let value = factor();
    while (value !== undefined && ['*', '/', '%'].includes(tokens[index] ?? '')) {
      const operator = tokens[index++]!; const right = factor();
      if (right === undefined || (operator !== '*' && right === 0)) {
        return undefined;
      }
      value = operator === '*' ? value * right : operator === '/' ? Math.trunc(value / right) : value % right;
    }
    return value;
  };
  const factor = (): number | undefined => {
    const token = tokens[index++];
    if (token === '(') {
      const value = expression(); return tokens[index++] === ')' ? value : undefined;
    }
    if (token && /^\d+u?$/.test(token)) {
      return Number(token.replace(/u$/, ''));
    }
    return token ? constant(token) : undefined;
  };
  const result = expression();
  return index === tokens.length && result !== undefined && Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}

function offset(source: string, line: number, character: number): number {
  let currentLine = 0; let index = 0;
  while (currentLine < line && index < source.length) {
    if (source[index++] === '\n') {
      currentLine += 1;
    }
  }
  return index + character;
}
