import type { WgslProjectTraceTarget } from '@shader-studio/types';

export interface WgslTraceState {
  available: boolean; reason: string | null; targets: readonly WgslProjectTraceTarget[];
  selectedTarget: string | null; invocation: [number, number, number]; vertexIndex: number; busy: boolean;
}
const DEFAULT: WgslTraceState = { available: false, reason: 'Select a pixel to trace.', targets: [], selectedTarget: null, invocation: [0, 0, 0], vertexIndex: 0, busy: false };
let state = $state<WgslTraceState>({ ...DEFAULT });
let startHandler: (() => void) | null = null;
let targetHandler: ((key: string) => void) | null = null;
let invocationHandler: ((axis: 0 | 1 | 2, value: number) => void) | null = null;
let vertexHandler: ((value: number) => void) | null = null;
export function getWgslTraceState(): WgslTraceState {
  return state;
}
export function setWgslTraceState(next: WgslTraceState | Partial<WgslTraceState>): void {
  state = { ...state, ...next };
}
export function registerWgslTraceStartHandler(handler: (() => void) | null): void {
  startHandler = handler;
}
export function registerWgslTraceControls(handlers: { target: (key: string) => void; invocation: (axis: 0 | 1 | 2, value: number) => void; vertex: (value: number) => void; } | null): void {
  targetHandler = handlers?.target ?? null; invocationHandler = handlers?.invocation ?? null; vertexHandler = handlers?.vertex ?? null;
}
export function requestWgslTraceStart(): void {
  startHandler?.();
}
export function selectWgslTraceTarget(key: string): void {
  targetHandler?.(key);
}
export function setWgslTraceInvocation(axis: 0 | 1 | 2, value: number): void {
  invocationHandler?.(axis, value);
}
export function setWgslTraceVertexIndex(value: number): void {
  vertexHandler?.(value);
}
export function resetWgslTraceState(): void {
  state = { ...DEFAULT }; startHandler = null; targetHandler = null; invocationHandler = null; vertexHandler = null;
}
