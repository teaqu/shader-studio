import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import BufferConfig from '../../lib/components/config/BufferConfig.svelte';
import '../../app.css';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (component) {
    await unmount(component);
  }
  component = undefined;
  document.body.replaceChildren();
  document.body.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.body.removeAttribute('style');
});

describe('clear controls follow the host theme', () => {
  it.each([
    ['light', 'vscode-light'],
    ['dark', 'vscode-dark'],
    ['light', 'vscode-high-contrast-light'],
    ['dark', 'vscode-high-contrast'],
  ])('%s controls in %s', async (theme, hostClass) => {
    // Opposite browser theme ensures the VS Code host wins for native controls.
    document.documentElement.dataset.theme = theme === 'light' ? 'dark' : 'light';
    document.body.className = hostClass;
    document.body.style.setProperty('--vscode-input-background', theme === 'light' ? '#f2f3f4' : '#252627');
    document.body.style.setProperty('--vscode-input-foreground', theme === 'light' ? '#202122' : '#e2e3e4');
    document.body.style.setProperty('--vscode-input-border', '#808182');
    document.body.style.setProperty('--vscode-focusBorder', '#123456');
    const target = document.createElement('div');
    document.body.append(target);
    component = mount(BufferConfig, { target, props: {
      bufferName: 'Image', isImagePass: true,
      config: { geometry: { type: 'cube', instanceCount: 9 }, clear: [0.25, 0.5, 0.75, 0.5] },
      onUpdate: vi.fn(), getWebviewUri: () => undefined,
    } });
    const alpha = target.querySelector<HTMLInputElement>('#clear-alpha-Image')!;
    const colour = target.querySelector<HTMLInputElement>('#clear-color-Image')!;
    await expect.poll(() => getComputedStyle(alpha).backgroundColor).toBe(theme === 'light' ? 'rgb(242, 243, 244)' : 'rgb(37, 38, 39)');
    expect(getComputedStyle(alpha).color).toBe(theme === 'light' ? 'rgb(32, 33, 34)' : 'rgb(226, 227, 228)');
    expect(getComputedStyle(colour).backgroundColor).toBe(getComputedStyle(alpha).backgroundColor);
    expect(getComputedStyle(alpha).colorScheme).toBe(theme);
    expect(getComputedStyle(colour).colorScheme).toBe(theme);
    const instances = target.querySelector<HTMLInputElement>('#instance-count-Image')!;
    expect(getComputedStyle(instances).backgroundColor).toBe(getComputedStyle(alpha).backgroundColor);
    expect(getComputedStyle(instances).colorScheme).toBe(theme);
    expect(instances.value).toBe('9');
    alpha.focus();
    expect(getComputedStyle(alpha).borderTopColor).toBe('rgb(18, 52, 86)');
    colour.focus();
    expect(getComputedStyle(colour).borderTopColor).toBe('rgb(18, 52, 86)');
    expect(alpha.value).toBe('0.5');
    expect(colour.value).toBe('#4080bf');
  });

  it.each(['light', 'dark'])('native standalone controls use the selected %s theme', (theme) => {
    document.documentElement.dataset.theme = theme;
    const input = document.createElement('input');
    input.type = 'color';
    document.body.append(input);
    expect(getComputedStyle(input).colorScheme).toBe(theme);
  });
});
