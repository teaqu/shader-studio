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
    { token: 'keyword.preprocessor.language', foreground: 'FF70FF' },
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
    'editorHoverWidget.background': '#1e1e1e',
    'editorSuggestWidget.background': '#1e1e1e',
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

/**
 * Light counterpart to the transparent editor theme. The overlay stays
 * transparent, but its tokens remain readable against a light workspace.
 */
export const shaderStudioTransparentLightTheme = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '9B1BAE' },
    { token: 'keyword.preprocessor', foreground: '3B3B3B' },
    { token: 'keyword.preprocessor.language', foreground: '9B1BAE' },
    { token: 'support.function', foreground: '7A4F00' },
    { token: 'variable.predefined', foreground: '007A87' },
    { token: 'type', foreground: '6336A8' },
    { token: 'number', foreground: 'A64A00' },
    { token: 'number.float', foreground: 'A64A00' },
    { token: 'number.hex', foreground: 'A64A00' },
    { token: 'comment', foreground: '287D28' },
    { token: 'string', foreground: '9A3D00' },
    { token: 'operator', foreground: '1F1F1F' },
    { token: 'delimiter', foreground: '1F1F1F' },
    { token: 'identifier', foreground: '1F1F1F' },
  ],
  colors: {
    'editor.background': '#00000000',
    'editorHoverWidget.background': '#ffffff',
    'editorSuggestWidget.background': '#ffffff',
    'editor.foreground': '#1f1f1f',
    'editor.lineHighlightBackground': '#0000000d',
    'editor.lineHighlightBorder': '#00000000',
    'editorGutter.background': '#00000000',
    'editorLineNumber.foreground': '#767676',
    'editorLineNumber.activeForeground': '#1f1f1f',
    'editorCursor.foreground': '#1f1f1f',
    'editorError.foreground': '#b42318',
    'editorError.border': '#00000000',
    'editorGutter.modifiedBackground': '#00000000',
    'editorGutter.addedBackground': '#00000000',
    'editorGutter.deletedBackground': '#00000000',
  } as Record<string, string>,
};
