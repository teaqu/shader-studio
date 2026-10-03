import { validateWgslTraceUniforms, type WgslTraceUniform } from './WgslTraceUniforms';

/** Experimental single-file fragment tracing, independent of snapshot debugging. */
export interface WgslTraceLaunch {
  source: string;
  path: string;
  width: number;
  height: number;
  pixel: [number, number];
  time: number;
  frame: number;
  capacity: number;
  customUniforms?: WgslTraceUniform[];
}

export interface WgslTraceVariable {
  name: string;
  type: string;
  component: 'f32' | 'i32' | 'u32' | 'bool';
  width: number;
}

export interface WgslTraceSite {
  id: number;
  /** One-based VS Code source coordinates; stops occur before execution. */
  line: number;
  column: number;
  variables: WgslTraceVariable[];
  /** Visible locals whose values cannot be recorded by this PoC. */
  unavailableVariables?: Array<{ name: string; type: string }>;
}

export interface WgslTracePlan {
  source: string;
  sites: WgslTraceSite[];
  recordWords: number;
  capacity: number;
}

export interface WgslTraceValue {
  name: string;
  type: string;
  /** Special floats are strings so JSON webview messaging preserves them. */
  value: number | boolean | string | (number | string)[];
}

export interface WgslTraceEvent {
  siteId: number;
  line: number;
  column: number;
  values: WgslTraceValue[];
}

export interface WgslTraceRecording {
  path: string;
  source: string;
  sites: WgslTraceSite[];
  events: WgslTraceEvent[];
  overflow: boolean;
  /** Final selected-pixel output, useful for comparing trace and shader results. */
  color: number[];
}

export function validateWgslTraceLaunch(launch: WgslTraceLaunch): void {
  validateWgslTraceUniforms(launch.customUniforms);
  if (!launch.path.endsWith('.wgsl') || typeof launch.source !== 'string') {
    throw new Error('The trace PoC requires a .wgsl source file.');
  }
  for (const size of [launch.width, launch.height]) {
    if (!Number.isInteger(size) || size < 1 || size > 2048) {
      throw new Error('Trace width and height must be integers from 1 to 2048.');
    }
  }
  if (!Array.isArray(launch.pixel) || launch.pixel.length !== 2
    || launch.pixel.some((value, axis) => !Number.isInteger(value) || value < 0
      || value >= (axis === 0 ? launch.width : launch.height))) {
    throw new Error('Trace pixel must be [x, y] inside the resolution, using a top-left origin.');
  }
  if (!Number.isFinite(launch.time) || !Number.isInteger(launch.frame) || launch.frame < 0 || launch.frame > 0x7fffffff) {
    throw new Error('Trace time must be finite and frame must be a nonnegative signed 32-bit integer.');
  }
  if (!Number.isInteger(launch.capacity) || launch.capacity < 1 || launch.capacity > 16384) {
    throw new Error('Trace capacity must be an integer from 1 to 16384.');
  }
}
