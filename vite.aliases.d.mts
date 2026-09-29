/** Shared source aliases used by the viewer and standalone Vite builds. */
export const shaderStudioAliases: Record<string, string>;

/** Maps monaco-vim's pre-0.57 `monaco-editor/esm/vs/...` imports onto Monaco's files. */
export const monacoLegacyEsmAlias: { find: RegExp; replacement: string };

/** The shared aliases plus `monacoLegacyEsmAlias`, in Vite's array form. */
export const shaderStudioAliasEntries: Array<{ find: string | RegExp; replacement: string }>;
