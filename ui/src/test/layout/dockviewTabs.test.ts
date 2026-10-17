import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workspacePath = resolve(process.cwd(), 'ui/src/lib/layout/singleTabHeaders.css');
const css = readFileSync(existsSync(workspacePath) ? workspacePath : resolve(process.cwd(), 'src/lib/layout/singleTabHeaders.css'), 'utf8');

afterEach(() => document.body.replaceChildren());

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
