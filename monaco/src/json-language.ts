import type { languages } from 'monaco-editor';

/**
 * Monarch tokenizer for the `.sha.json` shader configs opened in the editor.
 *
 * Monaco's own JSON mode lives behind a language worker, which the VS Code
 * webview's CSP blocks, so config files would otherwise fall back to the GLSL
 * tokenizer and pick up shader syntax errors. This tokenizer is worker-free.
 */
export const jsonLanguageDefinition: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.json',

  tokenizer: {
    root: [
      [/[{}[\]]/, '@brackets'],
      [/"([^"\\]|\\.)*"(?=\s*:)/, 'string.key.json'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, { token: 'string.value.json', next: '@string' }],
      [/-?\d+(\.\d+)?([eE][-+]?\d+)?/, 'number.json'],
      [/\b(?:true|false)\b/, 'keyword.json'],
      [/\bnull\b/, 'keyword.json'],
      [/[,:]/, 'delimiter'],
      [/\s+/, ''],
    ],

    string: [
      [/[^\\"]+/, 'string.value.json'],
      [/\\./, 'string.escape.json'],
      [/"/, { token: 'string.value.json', next: '@pop' }],
    ],
  },
};

/** Brackets, auto-closing pairs, and indentation for JSON documents. */
export const jsonLanguageConfiguration: languages.LanguageConfiguration = {
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};
