import type { languages } from 'monaco-editor';

// Mirrors monaco's `languages.IndentAction`. Spelled out here so this module
// stays type-only against monaco-editor and needs no runtime import of it.
const IndentAction = {
  None: 0,
  Indent: 1,
  IndentOutdent: 2,
  Outdent: 3,
} as const;

/**
 * Bracket, comment, and indentation rules shared by GLSL and Slang.
 *
 * Monaco only auto-indents on Enter when the language declares brackets and
 * indentation rules; without this configuration a newline after `{` stays at
 * column 0. The patterns mirror VS Code's C/C++ language configuration, which
 * is what both shading languages read as.
 */
export const shaderLanguageConfiguration: languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '/*', close: '*/', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  indentationRules: {
    // Indent after an unclosed `{`, `(` or `[` that is not inside a line comment.
    increaseIndentPattern: /^((?!\/\/).)*(\{[^}"']*|\([^)"']*|\[[^\]"']*)$/,
    // Outdent a line that starts by closing one of those brackets.
    decreaseIndentPattern: /^\s*[}\])].*$/,
  },
  onEnterRules: [
    {
      // Enter inside `/** … */` continues the block with a ` * ` prefix.
      beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
      afterText: /^\s*\*\/$/,
      action: {
        indentAction: IndentAction.IndentOutdent,
        appendText: ' * ',
      },
    },
    {
      beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
      action: {
        indentAction: IndentAction.None,
        appendText: ' * ',
      },
    },
    {
      beforeText: /^(\t|[ ])*[ ]\*([ ]([^*]|\*(?!\/))*)?$/,
      previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
      action: {
        indentAction: IndentAction.None,
        appendText: '* ',
      },
    },
    {
      // Stop continuing the block comment once it has been closed.
      beforeText: /^(\t|[ ])*[ ]\*\/\s*$/,
      action: {
        indentAction: IndentAction.None,
        removeText: 1,
      },
    },
  ],
};
