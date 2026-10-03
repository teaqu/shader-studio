import { describe, expect, it } from 'vitest';

import { OrbitCamera } from '../../preview3d/OrbitCamera';
import { multiplyMatrices } from '../../preview3d/math';

describe('OrbitCamera', () => {
  it('cancels an active drag when resetting for a new shader', () => {
    const canvas = document.createElement('canvas');
    const camera = new OrbitCamera();
    camera.attach(canvas);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, clientX: 20, clientY: 10 }));
    camera.reset();
    const initial = camera.getViewMatrix();
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, clientX: 40, clientY: 20 }));
    expect(camera.getViewMatrix()).toEqual(initial);
    camera.detach();
  });

  it('orbits while clamping pitch away from a singularity', () => {
    const camera = new OrbitCamera();

    camera.orbit(0, 10_000);

    expect(camera.getPitch()).toBeCloseTo(Math.PI / 2 - 0.01);
    expect(camera.getPosition()[1]).toBeGreaterThan(0);
  });

  it.each(['webgl', 'webgpu'] as const)('returns view, %s projection and their product for an aspect ratio', (depth) => {
    const camera = new OrbitCamera();
    camera.orbit(30, -12);

    const { view, projection, viewProjection } = camera.getMatrices(2, depth);

    expect(view).toEqual(camera.getViewMatrix());
    expect(projection).toEqual(camera.getProjectionMatrix(2, depth));
    expect(viewProjection).toEqual(multiplyMatrices(projection, view));
  });

  it('defaults the matrices to WebGL clip-space depth and maps the target to the clip-space centre', () => {
    const camera = new OrbitCamera();
    const { projection, viewProjection } = camera.getMatrices(1);
    expect(projection).toEqual(camera.getProjectionMatrix(1, 'webgl'));

    // The target (origin) is straight ahead, so it lands on x = y = 0 after the divide.
    const w = viewProjection[15]!;
    expect(viewProjection[12]! / w).toBeCloseTo(0);
    expect(viewProjection[13]! / w).toBeCloseTo(0);
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
