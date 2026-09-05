import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceComponentPath = resolve(process.cwd(), 'ui/src/lib/components/EditorOverlay.svelte');
const componentPath = existsSync(workspaceComponentPath)
  ? workspaceComponentPath
  : resolve(process.cwd(), 'src/lib/components/EditorOverlay.svelte');
const component = readFileSync(componentPath, 'utf8');

function rule(selector: string): string {
  const match = component.match(new RegExp(`${selector.replace(/[.+()]/g, '\\$&')}\\s*{[^}]*}`, 's'));
  expect(match, `${selector} is missing from EditorOverlay.svelte`).toBeTruthy();
  return match![0];
}

describe('EditorOverlay text backdrop styles', () => {
  it('keeps the shader-preview overlay text legible without styling the web editor pane', () => {
    const text = rule('.editor-wrapper:not(.pane) .editor-overlay :global(.monaco-editor .view-lines .view-line > span)');

    expect(text).toMatch(/background:\s*rgba\(10, 10, 10, 0\.75\);/);
    expect(text).toMatch(/text-shadow:\s*0 0 1px rgba\(0, 0, 0, 0\.8\), 0 0 3px rgba\(0, 0, 0, 0\.4\);/);
  });

  it('gives overlay line numbers the same backdrop', () => {
    expect(rule('.editor-wrapper:not(.pane) .editor-overlay :global(.monaco-editor .margin-view-overlays .line-numbers)'))
      .toMatch(/background:\s*rgba\(10, 10, 10, 0\.75\);/);
  });
});
