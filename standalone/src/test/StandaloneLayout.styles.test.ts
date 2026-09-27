// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('../StandaloneLayout.svelte', import.meta.url), 'utf8');

describe('standalone drop destination styles', () => {
  it('defines a theme-aware fill and visible outline for Dockview drop targets', () => {
    expect(component).toContain('--dv-drag-over-background-color: var(--vscode-editorGroup-dropBackground, rgba(0, 127, 212, 0.25));');
    expect(component).toContain('--dv-drag-over-border: 2px solid var(--vscode-focusBorder, #007fd4);');
    expect(component).toContain('--dv-drag-over-border-color: var(--vscode-focusBorder, #007fd4);');
  });
});

describe('standalone responsive layout styles', () => {
  it('stacks the dockview above the mobile navigation at the narrow breakpoint', () => {
    expect(component).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.standalone-layout\s*{[^}]*flex-direction: column/);
  });
});
