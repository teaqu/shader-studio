export interface SnippetContribution {
  language: 'glsl' | 'slang';
  path: string;
}

export const SNIPPET_CONTRIBUTIONS: readonly SnippetContribution[] = [
  { language: 'glsl', path: './snippets/sdf-2d.code-snippets' },
  { language: 'glsl', path: './snippets/sdf-3d.code-snippets' },
  { language: 'glsl', path: './snippets/math.code-snippets' },
  { language: 'glsl', path: './snippets/coordinates.code-snippets' },
  { language: 'slang', path: './snippets/sdf-2d.slang.code-snippets' },
  { language: 'slang', path: './snippets/sdf-3d.slang.code-snippets' },
  { language: 'slang', path: './snippets/math.slang.code-snippets' },
  { language: 'slang', path: './snippets/coordinates.slang.code-snippets' },
];
