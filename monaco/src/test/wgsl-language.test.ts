// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';

// jsdom does not implement CSS.escape, but Monaco uses the browser API when
// tokenizing. Keep this test environment browser-faithful with the CSSOM
// "serialize an identifier" algorithm (mirrors slang-language.test.ts).
function cssEscape(value: string): string {
  const source = String(value);
  let result = '';

  for (let index = 0; index < source.length; index += 1) {
    const codeUnit = source.charCodeAt(index);
    const character = source[index];

    if (codeUnit === 0x0000) {
      result += '\uFFFD';
    } else if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f)
      || codeUnit === 0x007f
      || (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && source.charCodeAt(0) === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
    } else if (index === 0 && source.length === 1 && codeUnit === 0x002d) {
      result += '\\-';
    } else if (
      codeUnit >= 0x0080
      || codeUnit === 0x002d
      || codeUnit === 0x005f
      || (codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (codeUnit >= 0x0041 && codeUnit <= 0x005a)
      || (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += character;
    } else {
      result += `\\${character}`;
    }
  }

  return result;
}

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: {} });
}

if (!globalThis.CSS.escape) {
  Object.defineProperty(globalThis.CSS, 'escape', {
    configurable: true,
    value: cssEscape,
  });
}

import {
  wgslAttributeKeywords,
  wgslBuiltins,
  wgslConstants,
  wgslControlKeywords,
  wgslDeclarationKeywords,
  wgslLanguageDefinition,
  wgslNumberPattern,
  wgslShadertoyUniforms,
  wgslTypes,
} from '../wgsl-language';
import { shaderStudioBuiltinUniformNames } from '@shader-studio/types';

describe('WGSL Monarch language', () => {
  let monaco: typeof import('monaco-editor/esm/vs/editor/editor.api.js');

  beforeAll(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
    const { setupMonacoWgsl } = await import('../setup');
    setupMonacoWgsl(monaco);
  }, 30_000);

  function tokenTypeFor(source: string, text: string): string {
    const tokens = monaco.editor.tokenize(source, 'wgsl')[0];
    const offset = source.indexOf(text);
    const token = [...tokens].reverse().find((candidate) => candidate.offset <= offset);
    if (!token) {
      throw new Error(`Missing wgsl token for ${JSON.stringify(text)}`);
    }
    return token.type;
  }

  it('covers the WGSL keyword families', () => {
    for (const keyword of ['fn', 'var', 'let', 'const', 'override', 'struct', 'alias', 'enable', 'requires', 'diagnostic', 'const_assert']) {
      expect(wgslDeclarationKeywords, keyword).toContain(keyword);
    }
    for (const keyword of ['if', 'else', 'switch', 'case', 'default', 'for', 'while', 'loop', 'break', 'continue', 'continuing', 'return', 'discard']) {
      expect(wgslControlKeywords, keyword).toContain(keyword);
    }
    expect(wgslConstants).toEqual(expect.arrayContaining(['true', 'false']));
  });

  it('covers WGSL types including predeclared aliases', () => {
    for (const type of ['bool', 'f32', 'f16', 'i32', 'u32', 'vec4f', 'vec2h', 'vec3i', 'vec4u', 'mat4x4f', 'mat3x2h', 'sampler', 'sampler_comparison']) {
      expect(wgslTypes, type).toContain(type);
    }
  });

  it('covers the closed attribute set', () => {
    for (const attribute of ['group', 'binding', 'location', 'builtin', 'vertex', 'fragment', 'compute', 'workgroup_size', 'size', 'align', 'interpolate', 'invariant', 'must_use', 'const', 'diagnostic', 'id']) {
      expect(wgslAttributeKeywords, attribute).toContain(attribute);
    }
  });

  it('covers WGSL built-in functions', () => {
    for (const builtin of ['textureSample', 'textureStore', 'arrayLength', 'atomicAdd', 'select', 'mix', 'smoothstep', 'dpdx', 'pack4x8unorm', 'workgroupUniformLoad', 'all', 'any', 'bitcast']) {
      expect(wgslBuiltins, builtin).toContain(builtin);
    }
  });

  it('matches every numeric literal form', () => {
    const matchesWhole = (value: string): boolean => new RegExp(`^(?:${wgslNumberPattern.source})$`).test(value);
    for (const literal of ['1', '42', '0x1F', '123i', '45u', '1.0', '0.5', '1e3', '1.5e-3', '2f', '3h', '0x1p3', '0xFFu']) {
      expect(matchesWhole(literal), literal).toBe(true);
    }
    expect(matchesWhole('1.2.3')).toBe(false);
  });

  it('tokenizes WGSL tokens with editor categories', () => {
    expect(tokenTypeFor('fn mainImage(coord: vec2f) -> vec4f {', 'fn')).toContain('keyword');
    expect(tokenTypeFor('var<private> x: f32;', 'var')).toContain('keyword');
    expect(tokenTypeFor('var<private> x: vec4f;', 'vec4f')).toContain('type');
    expect(tokenTypeFor('vec3<f32>(1.0)', 'vec3')).toContain('type');
    expect(tokenTypeFor('mat4x4<f32>(1.0)', 'mat4x4')).toContain('type');
    expect(tokenTypeFor('texture_external', 'texture_external')).toContain('type');
    expect(tokenTypeFor('textureSample(t, s, uv)', 'textureSample')).toContain('support.function');
    expect(tokenTypeFor('all(v)', 'all')).toContain('support.function');
    expect(tokenTypeFor('any(v)', 'any')).toContain('support.function');
    expect(tokenTypeFor('bitcast<f32>(x)', 'bitcast')).toContain('support.function');
    expect(tokenTypeFor('return vec4f(iTime);', 'iTime')).toContain('variable.predefined');
    expect(tokenTypeFor('let x = 1.5;', '1.5')).toContain('number');
    expect(tokenTypeFor('enable f16;', 'f16')).not.toContain('keyword');
    expect(tokenTypeFor('@group(0) var<uniform> u: vec4f;', '@group')).toContain('attribute');
    expect(tokenTypeFor('if x > 1 {', 'if')).toContain('keyword');
    expect(tokenTypeFor('shade(x)', 'shade')).toContain('support.function');
  });

  it('tokenizes nested block comments as comments', () => {
    const source = '/* outer /* inner */ still comment */ var x: f32;';
    const line = monaco.editor.tokenize(source, 'wgsl')[0];
    const varToken = [...line].reverse().find((candidate) => candidate.offset <= source.indexOf('var'));
    expect(varToken?.type).not.toContain('comment');
    for (const token of line) {
      if (token.offset < source.indexOf('*/ var')) {
        expect(token.type).toContain('comment');
      }
    }
  });

  it('has no string tokenization: WGSL has no string literals', () => {
    const line = monaco.editor.tokenize('enable "f16";', 'wgsl')[0];
    expect(line.some((token) => token.type.includes('string'))).toBe(false);
  });

  it('colours every built-in uniform the catalog declares for the language', () => {
    expect([...wgslShadertoyUniforms].sort()).toEqual([...shaderStudioBuiltinUniformNames('wgsl')].sort());
  });
});

describe('setupMonacoWgsl', () => {
  function createMockMonaco(initialLanguages: { id: string }[] = []) {
    const languages = [...initialLanguages];
    return {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
        setLanguageConfiguration: vi.fn(),
      },
    };
  }

  it('registers the WGSL tokenizer and language configuration once per Monaco instance', async () => {
    const monacoA = createMockMonaco();
    const monacoB = createMockMonaco();
    const { setupMonacoWgsl } = await import('../setup');
    const { wgslLanguageDefinition: definition } = await import('../wgsl-language');
    const { shaderLanguageConfiguration: configuration } = await import('../language-configuration');

    expect(setupMonacoWgsl(monacoA as never)).toBeUndefined();
    expect(setupMonacoWgsl(monacoA as never)).toBeUndefined();
    expect(setupMonacoWgsl(monacoB as never)).toBeUndefined();

    for (const monaco of [monacoA, monacoB]) {
      expect(monaco.languages.register).toHaveBeenCalledTimes(1);
      expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'wgsl' });
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('wgsl', definition);
      expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
      expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith('wgsl', configuration);
    }
  });

  it('exports the language definition from the public entry point', async () => {
    const entry = await import('../index');
    expect(entry.wgslLanguageDefinition).toBe(wgslLanguageDefinition);
  });
});
