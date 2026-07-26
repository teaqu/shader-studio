import { describe, expect, it } from 'vitest';
import { OrbitCamera } from '../../preview3d/OrbitCamera';

function pointerEvent(type: string, init: MouseEventInit): PointerEvent {
  return new MouseEvent(type, init) as PointerEvent;
}

describe('OrbitCamera', () => {
  it('starts framed on the origin', () => {
    const camera = new OrbitCamera();

    expect(camera.getPosition()[0]).toBeCloseTo(Math.sqrt(8));
    expect(camera.getPosition()[1]).toBeCloseTo(1.5);
    expect(camera.getPosition()[2]).toBeCloseTo(Math.sqrt(8));
    expect(camera.getPosition()[0]).not.toBeCloseTo(0);
    expect(camera.getTarget()).toEqual([0, 0, 0]);
  });

  it('orbits while clamping pitch away from a singularity', () => {
    const camera = new OrbitCamera();
    camera.orbit(0, 10_000);

    expect(camera.getPitch()).toBeCloseTo(Math.PI / 2 - 0.01);
    expect(camera.getPosition()[1]).toBeGreaterThan(0);
  });

  it('clamps dolly distance', () => {
    const camera = new OrbitCamera();
    camera.dolly(-1000);
    expect(camera.getDistance()).toBe(0.5);

    camera.dolly(10000);
    expect(camera.getDistance()).toBe(20);
  });

  it('pans the target in camera space', () => {
    const camera = new OrbitCamera();
    camera.pan(1, 0);

    expect(camera.getTarget()[0]).toBeLessThan(0);
    expect(camera.getTarget()[1]).toBe(0);
  });

  it('resets navigation state', () => {
    const camera = new OrbitCamera();
    camera.orbit(1, 1);
    camera.pan(2, 3);
    camera.dolly(-2);
    camera.reset();

    expect(camera.getPosition()[0]).not.toBeCloseTo(0);
    expect(camera.getPosition()[1]).toBeCloseTo(1.5);
    expect(camera.getPosition()[2]).toBeCloseTo(Math.sqrt(8));
    expect(camera.getTarget()).toEqual([0, 0, 0]);
  });

  it('routes DOM orbit, pan, wheel, disabled input, and detachment gestures', () => {
    const canvas = document.createElement('canvas');
    const camera = new OrbitCamera();
    camera.attach(canvas);
    const initial = camera.getPosition();

    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 20, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 20, clientY: 0, bubbles: true }));
    expect(camera.getPosition()).not.toEqual(initial);

    const targetBeforePan = camera.getTarget();
    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, shiftKey: true, clientX: 20, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(pointerEvent('pointermove', { button: 0, shiftKey: true, clientX: 30, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(pointerEvent('pointerup', { button: 0, clientX: 30, clientY: 0, bubbles: true }));
    expect(camera.getTarget()).not.toEqual(targetBeforePan);

    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);

    const positionBeforeDisabledMove = camera.getPosition();
    camera.setInputEnabled(false);
    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 30, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 50, clientY: 0, bubbles: true }));
    expect(camera.getPosition()).toEqual(positionBeforeDisabledMove);

    camera.setInputEnabled(true);
    camera.detach();
    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 0, clientX: 50, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(pointerEvent('pointermove', { button: 0, clientX: 70, clientY: 0, bubbles: true }));
    expect(camera.getPosition()).toEqual(positionBeforeDisabledMove);
  });
});
