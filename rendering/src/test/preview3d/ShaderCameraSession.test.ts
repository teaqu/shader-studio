import { describe, expect, it, vi } from 'vitest';
import { OrbitCamera } from '../../preview3d/OrbitCamera';
import { ShaderCameraSession } from '../../preview3d/ShaderCameraSession';

describe('ShaderCameraSession', () => {
  it('resets orbit, pan, and zoom on each new shader, including reopening an earlier shader', () => {
    const camera = new OrbitCamera();
    const initial = camera.getViewMatrix();
    const initialDistance = camera.getDistance();
    const session = new ShaderCameraSession(camera);
    for (const path of ['/first.wgsl', '/second.wgsl', '/first.wgsl']) {
      camera.orbit(24, 18);
      camera.pan(10, 7);
      camera.dolly(20);
      expect(camera.getViewMatrix()).not.toEqual(initial);
      session.install(path);
      expect(camera.getViewMatrix()).toEqual(initial);
      expect(camera.getTarget()).toEqual([0, 0, 0]);
      expect(camera.getDistance()).toBe(initialDistance);
    }
  });

  it('preserves navigation when the same shader is reinstalled', () => {
    const camera = new OrbitCamera();
    const session = new ShaderCameraSession(camera);
    session.install('/first.wgsl');
    camera.orbit(24, 18);
    camera.pan(10, 7);
    camera.dolly(20);
    const moved = camera.getViewMatrix();
    const distance = camera.getDistance();
    session.install('/first.wgsl');
    expect(camera.getViewMatrix()).toEqual(moved);
    expect(camera.getDistance()).toBe(distance);
  });

  it('does not commit a shader identity when reset fails', () => {
    const camera = { reset: vi.fn().mockImplementationOnce(() => {
      throw new Error('reset failed');
    }) };
    const session = new ShaderCameraSession(camera);
    expect(() => session.install('/first.wgsl')).toThrow('reset failed');
    session.install('/first.wgsl');
    session.install('/first.wgsl');
    expect(camera.reset).toHaveBeenCalledTimes(2);
  });
});
