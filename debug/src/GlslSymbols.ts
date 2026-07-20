import { GlslParser } from './GlslParser';

export interface GlslSymbolLocation {
  name: string;
  line: number;
  column: number;
}

export interface GlslFunctionSymbol extends GlslSymbolLocation {
  signature: string;
}

export interface GlslSymbolTable {
  functions: GlslFunctionSymbol[];
  globals: GlslSymbolLocation[];
  structs: GlslSymbolLocation[];
  defines: GlslSymbolLocation[];
}

const STRUCT_PATTERN = /^\s*struct\s+([A-Za-z_]\w*)/;
const DEFINE_PATTERN = /^\s*#\s*define\s+([A-Za-z_]\w*)/;
const FUNCTION_FALLBACK_PATTERN = /^\s*(?:[A-Za-z_]\w*\s+)+([A-Za-z_]\w*)\s*\(/;

function columnOf(line: string | undefined, name: string): number {
  const index = line?.indexOf(name) ?? -1;
  return index >= 0 ? index : 0;
}

function functionSymbols(lines: string[]): GlslFunctionSymbol[] {
  const parsed = GlslParser.getFunctions(lines);
  if (parsed.length > 0) {
    return parsed.map((fn) => ({
      name: fn.name,
      line: fn.start,
      column: columnOf(lines[fn.start], fn.name),
      signature: GlslParser.getFullFunctionSignature(lines, fn.start).trim(),
    }));
  }
  // Parse failed (mid-edit source): regex scan for definition-shaped lines
  // whose statement opens a body rather than ending as a prototype.
  const fallback: GlslFunctionSymbol[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FUNCTION_FALLBACK_PATTERN);
    if (!match || lines[i].trimEnd().endsWith(';')) {
      continue;
    }
    fallback.push({
      name: match[1],
      line: i,
      column: columnOf(lines[i], match[1]),
      signature: GlslParser.getFullFunctionSignature(lines, i).trim(),
    });
  }
  return fallback;
}

function lineSymbols(lines: string[], pattern: RegExp): GlslSymbolLocation[] {
  const symbols: GlslSymbolLocation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (match) {
      symbols.push({ name: match[1], line: i, column: columnOf(lines[i], match[1]) });
    }
  }
  return symbols;
}

export function getSymbolTable(lines: string[]): GlslSymbolTable {
  return {
    functions: functionSymbols(lines),
    globals: GlslParser.getGlobalVariables(lines).map((variable) => ({
      name: variable.name,
      line: variable.declarationLine,
      column: columnOf(lines[variable.declarationLine], variable.name),
    })),
    structs: lineSymbols(lines, STRUCT_PATTERN),
    defines: lineSymbols(lines, DEFINE_PATTERN),
  };
}

export function findSymbol(table: GlslSymbolTable, name: string): GlslSymbolLocation | undefined {
  return table.functions.find((symbol) => symbol.name === name)
    ?? table.structs.find((symbol) => symbol.name === name)
    ?? table.defines.find((symbol) => symbol.name === name)
    ?? table.globals.find((symbol) => symbol.name === name);
}
