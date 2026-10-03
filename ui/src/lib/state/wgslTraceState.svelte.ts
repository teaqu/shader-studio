export interface WgslTraceState {
  available: boolean;
  reason: string | null;
}

const DEFAULT: WgslTraceState = { available: false, reason: 'Select a pixel to trace.' };

let state = $state<WgslTraceState>({ ...DEFAULT });
let startHandler: (() => void) | null = null;

export function getWgslTraceState(): WgslTraceState {
  return state;
}

export function setWgslTraceState(next: WgslTraceState): void {
  state = next;
}

export function registerWgslTraceStartHandler(handler: (() => void) | null): void {
  startHandler = handler;
}

export function requestWgslTraceStart(): void {
  startHandler?.();
}

export function resetWgslTraceState(): void {
  state = { ...DEFAULT };
  startHandler = null;
}
