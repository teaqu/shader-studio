import { StreamLanguage } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { editorLanguage, wgslParser } from '../languages';

function tokens(source: string): Array<{ text: string; classes: string }> {
  const tree = StreamLanguage.define(wgslParser).parser.parse(source);
  const result: Array<{ text: string; classes: string }> = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    result.push({ text: source.slice(from, to), classes });
  });
  return result;
}

describe('WGSL language support', () => {
  it('classifies shader syntax, built-ins, literals, strings and operators', () => {
    const source = '@fragment fn main() {\n  let value: vec3<f32> = textureSample(iChannel0, sampler0, vec2<f32>(.5));\n  // note\n  return value.x + 0x1.fp2;\n}';
    const highlighted = tokens(source);
    expect(highlighted).toEqual(expect.arrayContaining([
      { text: '@fragment', classes: 'tok-meta' },
      { text: 'fn', classes: 'tok-keyword' },
      { text: 'vec3', classes: 'tok-typeName' },
      { text: 'f32', classes: 'tok-typeName' },
      { text: 'textureSample', classes: 'tok-variableName' },
      { text: 'iChannel0', classes: 'tok-variableName' },
      { text: '.5', classes: 'tok-number' },
      { text: '// note', classes: 'tok-comment' },
      { text: '+', classes: 'tok-operator' },
      { text: '0x1.fp2', classes: 'tok-number' },
    ]));
  });

  it('keeps block comments across lines and handles unterminated strings', () => {
    const source = '/* opening\nstill a comment */\nlet label = "unfinished';
    const highlighted = tokens(source);
    expect(highlighted).toEqual(expect.arrayContaining([
      { text: '/* opening', classes: 'tok-comment' },
      { text: 'still a comment */', classes: 'tok-comment' },
      { text: '"unfinished', classes: 'tok-string' },
    ]));
  });

  it('uses balanced indentation and never makes it negative', () => {
    const state = wgslParser.startState?.(2);
    expect(state).toBeDefined();
    if (!state) {
      throw new Error('WGSL parser must create an initial state');
    }
    state.depth = 2;
    expect(wgslParser.indent?.(state, '}', { unit: 2 } as never)).toBe(2);
    state.depth = 0;
    expect(wgslParser.indent?.(state, '}', { unit: 2 } as never)).toBe(0);
  });

  it.each([
    ['shader.wgsl'], ['config.json'], ['script.ts'], ['component.tsx'], ['script.js'], ['component.jsx'], ['shader.glsl'], ['shader.slang'], ['untitled'],
  ])('returns a parsing extension for %s', (path) => {
    expect(editorLanguage(path)).toBeTruthy();
  });
});
