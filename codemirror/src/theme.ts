import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

export function editorTheme(dark: boolean, overlay: boolean, fontSize: number): Extension {
  const dim = dark || overlay;
  const colors = dim ? {
    foreground: '#d4d4d4',
    cursor: '#fff',
    gutter: '#aaa',
    activeLine: 'rgb(255 255 255 / 6%)',
    selection: '#264f78',
    popupForeground: '#ddd',
    popupBackground: '#252526',
    border: '#555',
    fold: '#aaa',
    keyword: '#c586c0',
    type: '#4ec9b0',
    number: '#b5cea8',
    string: '#ce9178',
    comment: '#6a9955',
    function: '#dcdcaa',
    meta: '#9cdcfe',
  } : {
    foreground: '#24292e',
    cursor: '#111',
    gutter: '#6e7781',
    activeLine: 'rgb(0 0 0 / 4%)',
    selection: '#b6d8ff',
    popupForeground: '#24292e',
    popupBackground: '#fff',
    border: '#ccc',
    fold: '#555',
    keyword: '#af00db',
    type: '#267f99',
    number: '#098658',
    string: '#a31515',
    comment: '#008000',
    function: '#795e26',
    meta: '#0000ff',
  };
  return [EditorView.theme({
    '&': { fontSize: `${fontSize}px`, color: colors.foreground, backgroundColor: 'transparent' },
    // External tooltip containers also receive the theme classes. Only the
    // editor itself should fill its parent.
    '&.cm-editor': { height: '100%' },
    // iOS zooms focused editable text below 16px. Match the host's mobile
    // detection so this also covers touch devices in landscape orientation.
    '@media (max-width: 767px), (pointer: coarse)': {
      '.cm-scroller, .cm-panels': { fontSize: `${Math.max(16, fontSize)}px` },
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--vscode-editor-font-family, monospace)', lineHeight: '1.45', overscrollBehavior: 'contain' },
    '.cm-content': { padding: '4px 0', caretColor: colors.cursor, minHeight: '100%', ...(overlay ? { textShadow: '0 1px 3px #000' } : {}) },
    '.cm-line': { padding: '0 6px', ...(overlay ? { backgroundColor: 'rgb(10 10 10 / 75%)', width: 'fit-content', minWidth: '1px' } : {}) },
    '.cm-gutters': { backgroundColor: overlay ? 'rgb(10 10 10 / 75%)' : 'transparent', color: colors.gutter, border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: colors.activeLine },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: colors.selection },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: colors.cursor },
    '.cm-tooltip, .cm-panels': { color: colors.popupForeground, backgroundColor: colors.popupBackground, borderColor: colors.border },
    '.cm-tooltip': { maxWidth: 'min(500px, 90vw)', zIndex: '1500' },
    '.cm-tooltip-hover': { height: 'max-content', maxHeight: 'min(320px, 60dvh)', maxWidth: 'min(360px, 90vw)', overflowY: 'auto', padding: '8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
    '.cm-panels input, .cm-panels button': { font: 'inherit', maxWidth: '100%' },
    '.cm-search': { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' },
    '.cm-search input': { minWidth: '0', width: '10em' },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', color: colors.fold, borderColor: colors.border },
  }, { dark: dim }), syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: colors.keyword },
    { tag: [tags.typeName, tags.className], color: colors.type },
    { tag: [tags.number, tags.bool], color: colors.number },
    { tag: [tags.string, tags.regexp], color: colors.string },
    { tag: tags.comment, color: colors.comment },
    { tag: [tags.function(tags.variableName), tags.standard(tags.variableName)], color: colors.function },
    { tag: [tags.meta, tags.annotation], color: colors.meta },
  ]))];
}
