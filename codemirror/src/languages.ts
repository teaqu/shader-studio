import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

interface ShaderState { blockComment: boolean; depth: number; }
const keywords = new Set('fn var let const override struct alias enable requires diagnostic if else for while loop continuing break continue return discard switch case default true false function uniform varying attribute in out inout layout precision highp mediump lowp static public private import export module namespace interface __generic where mutating differentiable'.split(' '));
const types = /^(?:void|bool|[biud]?vec[234]|mat[234](?:x[234])?|float[234]?(?:x[234])?|half[234]?|double|int[234]?|uint[234]?|[fiu](?:16|32|64)|vec[234][fiuh]?|array|atomic|ptr|sampler\w*|texture(?:_[A-Za-z0-9]+)?|RW\w*|StructuredBuffer|ConstantBuffer)$/;
const builtins = /^(?:iTime|iResolution|iMouse|iFrame|iTimeDelta|iChannel\d+|iDate|iSampleRate|gl_\w+|sin|cos|tan|abs|min|max|clamp|mix|lerp|smoothstep|step|dot|cross|normalize|length|distance|texture|textureLod|textureSample|textureLoad|textureStore|pow|sqrt|exp|log|fract|floor|ceil|mod|select)$/;

/** WGSL's attributes and type syntax need their own tokenizer; C++ handles GLSL/Slang. */
export const wgslParser: StreamParser<ShaderState> = {
  startState: () => ({ blockComment: false, depth: 0 }),
  token(stream, state) {
    if (state.blockComment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.blockComment = false;
      } else {
        stream.skipToEnd();
      }
      return 'comment';
    }
    if (stream.eatSpace()) {
      return null;
    }
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.blockComment = true;
      return 'comment';
    }
    if (stream.match(/@\w+/)) {
      return 'meta';
    }
    if (stream.match(/"(?:[^"\\]|\\.)*(?:"|$)/)) {
      return 'string';
    }
    if (stream.match(/(?:0[xX][\da-fA-F]+(?:\.[\da-fA-F]*)?(?:[pP][+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[fhiu]?/)) {
      return 'number';
    }
    if (stream.match(/[A-Za-z_]\w*/)) {
      const word = stream.current();
      return keywords.has(word) ? 'keyword' : types.test(word) ? 'typeName' : builtins.test(word) ? 'variableName' : 'variableName';
    }
    const character = stream.next();
    if (character === '{') {
      state.depth++;
    } else if (character === '}') {
      state.depth = Math.max(0, state.depth - 1);
    }
    return /[+*/%=!<>&|^~?:-]/.test(character ?? '') ? 'operator' : null;
  },
  indent: (state, textAfter, context) => Math.max(0, state.depth - Number(/^\s*}/.test(textAfter))) * context.unit,
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } }, closeBrackets: { brackets: ['(', '[', '{', '"'] } },
};

export function editorLanguage(path: string): Extension {
  const extension = path.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'json': return json();
    case 'ts': case 'tsx': return javascript({ typescript: true, jsx: extension === 'tsx' });
    case 'js': case 'jsx': return javascript({ jsx: extension === 'jsx' });
    case 'wgsl': return StreamLanguage.define(wgslParser);
    default: return cpp();
  }
}
