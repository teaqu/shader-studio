import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createShaderTab } from '../../lib/layout/dockviewTabs';
import { debugPanelStore } from '../../lib/stores/debugPanelStore';
import { afterEach, describe, expect, it } from 'vitest';
import { setupDockviewTabs } from '../../lib/layout/dockviewTabs';

const workspacePath = resolve(process.cwd(), 'ui/src/lib/layout/singleTabHeaders.css');
const css = readFileSync(existsSync(workspacePath) ? workspacePath : resolve(process.cwd(), 'src/lib/layout/singleTabHeaders.css'), 'utf8');

afterEach(() => document.body.replaceChildren());

describe('divider drags', () => {
  it('prevents native tab dragging from interrupting a divider resize', () => {
    const dock = document.createElement('div');
    const sash = document.createElement('div');
    sash.className = 'dv-sash';
    const child = document.createElement('span');
    sash.append(child);
    const tab = document.createElement('div');
    dock.append(sash, tab);
    document.body.append(dock);
    const dispose = setupDockviewTabs(dock, { onDidLayoutChange: () => ({ dispose() {} }) });
    try {
      const dividerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
      child.dispatchEvent(dividerDown);
      expect(dividerDown.defaultPrevented).toBe(true);
      document.dispatchEvent(new Event('pointerup'));
      const tabDown = new Event('pointerdown', { bubbles: true, cancelable: true });
      tab.dispatchEvent(tabDown);
      expect(tabDown.defaultPrevented).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe('single-tab header styles', () => {
  function setup(single: boolean) {
    const style = document.createElement('style');
    style.textContent = css;
    const dock = document.createElement('div');
    dock.className = 'dv-autohide-tabs';
    const header = document.createElement('div');
    header.className = `dv-tabs-and-actions-container${single ? ' dv-single-tab' : ''}`;
    dock.append(header);
    document.body.append(style, dock);
    return { dock, header };
  }

  it('hides single headers without taking up content space', () => {
    const { header } = setup(true);
    const style = getComputedStyle(header);
    expect(style.opacity).toBe('0');
    expect(style.pointerEvents).toBe('none');
    expect(style.position).toBe('absolute');
  });

  it.each(['dv-sash-hover', 'dv-drag-active'])('reveals a single header during %s', (state) => {
    const { dock, header } = setup(true);
    dock.classList.add(state);
    const style = getComputedStyle(header);
    expect(style.opacity).toBe('1');
    expect(style.pointerEvents).toBe('auto');
    expect(style.position).toBe('absolute');
  });

  it('leaves multiple tabs visible and in normal layout', () => {
    const { header } = setup(false);
    const style = getComputedStyle(header);
    expect(style.opacity).not.toBe('0');
    expect(style.pointerEvents).not.toBe('none');
    expect(style.position).not.toBe('absolute');
  });

  it('updates automatically when a group gains or loses a second tab', () => {
    const { header } = setup(true);
    header.classList.remove('dv-single-tab');
    expect(getComputedStyle(header).opacity).not.toBe('0');
    header.classList.add('dv-single-tab');
    expect(getComputedStyle(header).opacity).toBe('0');
  });
});

describe('Debug tab line rendering indicator', () => {
  it('only customizes Debug and follows the toggle until disposed', () => {
    expect(createShaderTab({ id: 'config', name: 'config' })).toBeUndefined();
    debugPanelStore.setInlineRenderingEnabled(false);
    const tab = createShaderTab({ id: 'debug', name: 'debug' })!;
    const indicator = tab.element.querySelector<HTMLElement>('[aria-label="Line rendering enabled"]')!;
    expect(indicator.hidden).toBe(true);
    debugPanelStore.setInlineRenderingEnabled(true);
    expect(indicator.hidden).toBe(false);
    debugPanelStore.setInlineRenderingEnabled(false);
    expect(indicator.hidden).toBe(true);
    tab.dispose();
    debugPanelStore.setInlineRenderingEnabled(true);
    expect(indicator.hidden).toBe(true);
  });
});
