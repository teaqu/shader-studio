import { describe, expect, it } from 'vitest';

import { OrbitCamera } from '../../preview3d/OrbitCamera';

describe('OrbitCamera', () => {
  it('orbits while clamping pitch away from a singularity', () => {
    const camera = new OrbitCamera();

    camera.orbit(0, 10_000);

    expect(camera.getPitch()).toBeCloseTo(Math.PI / 2 - 0.01);
    expect(camera.getPosition()[1]).toBeGreaterThan(0);
  });

  it('clamps dolly distance', () => {
    const camera = new OrbitCamera();

    camera.dolly(-1_000);
    expect(camera.getDistance()).toBe(0.5);
    camera.dolly(10_000);
    expect(camera.getDistance()).toBe(20);
  });

  it('pans its target in camera space and resets navigation state', () => {
    const camera = new OrbitCamera();
    camera.pan(1, 0);
    expect(camera.getTarget()[0]).toBeLessThan(0);
    expect(camera.getTarget()[1]).toBe(0);

    camera.orbit(1, 1);
    camera.dolly(-2);
    camera.reset();
    expect(camera.getTarget()).toEqual([0, 0, 0]);
    expect(camera.getPosition()[1]).toBeCloseTo(1.5);
  });

  it('routes DOM orbit, pan, wheel, disabled input, and detachment gestures', () => {
    const canvas = document.createElement('canvas');
    const camera = new OrbitCamera();
    camera.attach(canvas);
    const initial = camera.getPosition();

    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, clientX: 20, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 20, clientY: 0, bubbles: true }));
    expect(camera.getPosition()).not.toEqual(initial);

    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);

    const positionBeforeDisabledMove = camera.getPosition();
    camera.setInputEnabled(false);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 20, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, clientX: 40, clientY: 0, bubbles: true }));
    expect(camera.getPosition()).toEqual(positionBeforeDisabledMove);

    camera.setInputEnabled(true);
    camera.detach();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, clientX: 60, clientY: 0, bubbles: true }));
    expect(camera.getPosition()).toEqual(positionBeforeDisabledMove);
  });
});
