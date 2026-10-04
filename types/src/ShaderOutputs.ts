import { getShaderSourceFunctions, tokenizeShaderSource, type ShaderSourceToken } from './ShaderEntryPoints';
import type { ShaderLanguageId } from './shader-environment/ShaderLanguages';

export interface ShaderOutput { slot: number; name?: string; }
export interface ShaderOutputDiscovery { outputs: ShaderOutput[]; error?: string; }
type Token = ShaderSourceToken;

/** Discovers the selected stage's declared colour slots. Compilation remains the validator. */
export function getShaderOutputs(source: string, language: ShaderLanguageId, entryPoint?: string): ShaderOutputDiscovery {
  if (!entryPoint || language === 'glsl') {
    return { outputs: [{ slot: 0 }] };
  }
  const entry = getShaderSourceFunctions(source, language).find(fn => fn.name === entryPoint && fn.stage === 'fragment');
  if (!entry) {
    return failure(`Fragment function "${entryPoint}" is missing or incomplete`);
  }
  const tokens = tokenizeShaderSource(source);
  const header = tokens.filter(token => token.start >= entry.start && token.end < entry.bodyStart);
  const signature = returnSignature(header, entryPoint, language);
  if (!signature) {
    return failure(`Cannot discover outputs of fragment function "${entryPoint}"`);
  }
  const direct = colourSlot(signature.declaration, language);
  let outputs: ShaderOutput[];
  if (direct !== undefined) {
    outputs = [{ slot: direct }];
  } else {
    const fields = structFields(tokens, resolveAlias(tokens, signature.type), language);
    if (!fields) {
      return failure(`Cannot resolve fragment output type "${signature.type}"`);
    }
    outputs = fields.flatMap(field => {
      const slot = colourSlot(field, language);
      if (slot === undefined) {
        return [];
      }
      const colon = field.findIndex(token => token.text === ':');
      const name = colon > 0 ? field[colon - 1]?.text : undefined;
      return [{ slot, ...(name ? { name } : {}) }];
    });
  }
  outputs.sort((a, b) => a.slot - b.slot);
  if (!outputs.length) {
    return failure(`Fragment function "${entryPoint}" has no declared colour outputs`);
  }
  if (outputs.some((output, index) => output.slot !== index)) {
    return failure('Fragment colour outputs must use unique contiguous slots starting at 0');
  }
  return { outputs };
}

function failure(error: string): ShaderOutputDiscovery {
  return { outputs: [], error };
}

function returnSignature(header: Token[], entryPoint: string, language: ShaderLanguageId): { type: string; declaration: Token[] } | undefined {
  const name = header.findIndex((token, index) => token.text === entryPoint && header[index + 1]?.text === '(');
  if (name < 0) {
    return undefined;
  }
  let depth = 0;
  let closing = -1;
  for (let index = name + 1; index < header.length; index++) {
    if (header[index]?.text === '(') {
      depth++;
    } else if (header[index]?.text === ')' && --depth === 0) {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    return undefined;
  }
  if (language === 'slang') {
    return { type: header[name - 1]?.text ?? '', declaration: header.slice(closing + 1) };
  }
  if (header[closing + 1]?.text !== '-' || header[closing + 2]?.text !== '>') {
    return undefined;
  }
  const declaration = header.slice(closing + 3).filter(token => token.text !== '{');
  const type = declaration.find(token => token.kind === 'identifier')?.text ?? '';
  return { type, declaration };
}

function colourSlot(tokens: Token[], language: ShaderLanguageId): number | undefined {
  if (language === 'slang') {
    const semantic = tokens.find(token => /^SV_Target\d*$/i.test(token.text));
    return semantic ? Number(semantic.text.slice(9) || 0) : undefined;
  }
  const location = tokens.findIndex((token, index) => token.text === '@' && tokens[index + 1]?.text === 'location');
  if (location < 0 || tokens[location + 2]?.text !== '(') {
    return undefined;
  }
  const closing = tokens.findIndex((token, index) => index > location + 2 && token.text === ')');
  const value = tokens.slice(location + 3, closing).map(token => token.text).join('');
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

function resolveAlias(tokens: Token[], type: string): string {
  const visited = new Set<string>();
  let current = type;
  while (!visited.has(current)) {
    visited.add(current);
    const alias = tokens.findIndex((token, index) => token.text === 'alias' && tokens[index + 1]?.text === current && tokens[index + 2]?.text === '=');
    if (alias < 0) {
      return current;
    }
    current = tokens[alias + 3]?.text ?? current;
  }
  return current;
}

function structFields(tokens: Token[], type: string, language: ShaderLanguageId): Token[][] | undefined {
  const start = tokens.findIndex((token, index) => token.text === 'struct' && tokens[index + 1]?.text === type && tokens[index + 2]?.text === '{');
  if (start < 0) {
    return undefined;
  }
  const fields: Token[][] = [];
  let field: Token[] = [];
  let nesting = 0;
  for (const token of tokens.slice(start + 3)) {
    if (token.text === '}' && nesting === 0) {
      if (field.length) {
        fields.push(field);
      }
      return fields;
    }
    if (['(', '<', '[', '{'].includes(token.text)) {
      nesting++;
    } else if ([')', '>', ']', '}'].includes(token.text)) {
      nesting--;
    }
    if (nesting === 0 && token.text === (language === 'wgsl' ? ',' : ';')) {
      fields.push(field);
      field = [];
    } else {
      field.push(token);
    }
  }
  return undefined;
}
