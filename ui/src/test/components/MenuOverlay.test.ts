import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { MenuOverlay } from '../../lib/components/menu/MenuOverlay.svelte';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}

describe('MenuOverlay', () => {
  it('opens and closes independently of its DOM anchors', () => {
    const overlay = new MenuOverlay('below-left');

    expect(overlay.open).toBe(false);
    overlay.toggle();
    expect(overlay.open).toBe(true);
    overlay.close();
    expect(overlay.open).toBe(false);
  });

  it('positions a visible menu within the viewport after both anchors are available', async () => {
    const overlay = new MenuOverlay('below-left');
    const trigger = document.createElement('button');
    const menu = document.createElement('div');
    Object.defineProperty(trigger, 'getBoundingClientRect', { value: () => rect(900, 700, 40, 20) });
    Object.defineProperty(menu, 'getBoundingClientRect', { value: () => rect(0, 0, 180, 160) });

    overlay.trigger = trigger;
    overlay.element = menu;
    overlay.open = true;
    await tick();

    expect(overlay.visible).toBe(true);
    expect(overlay.position.top).toBeGreaterThanOrEqual(8);
    expect(overlay.position.left).toBeGreaterThanOrEqual(8);
  });

  it('stops reacting to anchor changes after disposal', async () => {
    const overlay = new MenuOverlay('below-left');
    const trigger = document.createElement('button');
    const menu = document.createElement('div');
    Object.defineProperty(trigger, 'getBoundingClientRect', { value: () => rect(20, 20, 40, 20) });
    Object.defineProperty(menu, 'getBoundingClientRect', { value: () => rect(0, 0, 180, 160) });

    overlay.trigger = trigger;
    overlay.element = menu;
    overlay.open = true;
    await tick();
    expect(overlay.visible).toBe(true);

    overlay.dispose();
    overlay.open = false;
    await tick();

    expect(overlay.visible).toBe(true);
  });

  it('recognizes targets inside its portal element', () => {
    const overlay = new MenuOverlay('below-right');
    const menu = document.createElement('div');
    const child = document.createElement('button');
    menu.append(child);
    overlay.element = menu;

    expect(overlay.contains(child)).toBe(true);
    expect(overlay.contains(document.createElement('div'))).toBe(false);
  });
});
