// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('../EditorPane.svelte', import.meta.url), 'utf8');

describe('EditorPane theme styles', () => {
  it('inherits the shared editor palette instead of overriding light colours with dark fallbacks', () => {
    expect(component).not.toMatch(/--shader-studio-editor-[\w-]+:/);
  });
  it('uses paired VS Code status colours with theme-aware fallbacks', () => {
    expect(component).toContain('background: var(--vscode-statusBar-background, var(--vscode-sideBar-background));');
    expect(component).toContain('color: var(--vscode-statusBar-foreground, var(--vscode-foreground));');
    expect(component).toContain('border-top: 1px solid var(--vscode-panel-border);');
  });

  it('lets the Vim toggle inherit the footer colours and themes interaction states', () => {
    const toggle = component.match(/\.vim-toggle\s*\{([^}]+)\}/)?.[1];
    expect(toggle).toContain('background: transparent;');
    expect(toggle).toContain('color: inherit;');
    expect(component).toContain('var(--vscode-toolbar-hoverBackground)');
    expect(component).toContain('var(--vscode-focusBorder)');
  });
});
