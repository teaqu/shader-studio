/**
 * Shader Studio theme for Monaco editor with dark background.
 * Used in the snippet browser and other non-overlay contexts.
 */
export const shaderStudioTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'FF70FF' },
    { token: 'keyword.preprocessor', foreground: 'F0F0F0' },
    { token: 'support.function', foreground: 'FFF550' },
    { token: 'variable.predefined', foreground: '50F5FF' },
    { token: 'type', foreground: 'CC99FF' },
    { token: 'number', foreground: 'FFB866' },
    { token: 'number.float', foreground: 'FFB866' },
    { token: 'number.hex', foreground: 'FFB866' },
    { token: 'comment', foreground: '4DBF4D' },
    { token: 'string', foreground: 'FFA070' },
    { token: 'operator', foreground: 'F8F8F8' },
    { token: 'delimiter', foreground: 'F8F8F8' },
    { token: 'identifier', foreground: 'FFFFFF' },
  ],
  colors: {} as Record<string, string>,
};

/**
 * Transparent variant of the Shader Studio theme.
 * Used in the editor overlay where the shader renders behind the code.
 */
export const shaderStudioTransparentTheme = {
  ...shaderStudioTheme,
  colors: {
    'editor.background': '#00000000',
    'editor.lineHighlightBackground': '#ffffff12',
    'editor.lineHighlightBorder': '#ffffff08',
    'editorGutter.background': '#00000000',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#c6c6c6',
    'editorCursor.foreground': '#ffffff',
    'editorError.foreground': '#ff2020',
    'editorError.border': '#00000000',
    'editorGutter.modifiedBackground': '#00000000',
    'editorGutter.addedBackground': '#00000000',
    'editorGutter.deletedBackground': '#00000000',
  },
};
