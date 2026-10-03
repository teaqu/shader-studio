import { validateWgslTraceLaunch, type WgslTraceFrameUniforms, type WgslTraceUniform } from '@shader-studio/types';

/** Convert a preview snapshot to a launch without allowing a different adapter. */
export function createWgslTraceDebugConfiguration(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Inspect a WGSL pixel before starting a trace.');
  }
  const request = payload as Record<string, unknown>;
  if (typeof request.program !== 'string' || typeof request.source !== 'string') {
    throw new Error('The trace needs the current WGSL shader path and source.');
  }
  const launch = { path: request.program, source: request.source,
    width: request.width as number, height: request.height as number, pixel: request.pixel as [number, number],
    time: request.time as number, frame: request.frame as number, capacity: request.capacity as number,
    customUniforms: request.customUniforms as WgslTraceUniform[] | undefined,
    uniforms: request.uniforms as WgslTraceFrameUniforms | undefined };
  validateWgslTraceLaunch(launch);
  return { type: 'shader-studio-wgsl-trace', request: 'launch',
    name: `Trace inspected WGSL pixel (${launch.pixel.join(', ')})`, program: launch.path,
    source: launch.source, width: launch.width, height: launch.height, pixel: launch.pixel,
    time: launch.time, frame: launch.frame, capacity: launch.capacity,
    customUniforms: launch.customUniforms, uniforms: launch.uniforms };
}
