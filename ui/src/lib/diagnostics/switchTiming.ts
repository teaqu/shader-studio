/**
 * Shader-switch timing diagnostics.
 *
 * Measures the backend-swap path: canvas remount, engine setup, and the replay
 * of the message that triggered the swap. Useful when investigating switch
 * latency, and pure noise otherwise - a single edit to a shader emits a line
 * per keystroke.
 *
 * Toggle at runtime from the devtools console:
 *   window.__shaderSwitchDiag = true   // enable
 *   window.__shaderSwitchDiag = false  // disable
 *
 * Mirrors the capture diagnostics toggle in @shader-studio/rendering.
 */
interface SwitchDiagWindow {
  __shaderSwitchDiag?: boolean;
}

export function switchTimingEnabled(): boolean {
  // Keep test output clean — never log under the test runner.
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.VITEST || proc?.env?.NODE_ENV === 'test') {
    return false;
  }
  return (globalThis as unknown as SwitchDiagWindow).__shaderSwitchDiag === true;
}

/** Log one shader-switch timing event. No-op unless explicitly enabled. */
export function logSwitchTiming(event: string, detail: Record<string, unknown>): void {
  if (!switchTimingEnabled()) {
    return;
  }
  console.info(`[ShaderSwitchTiming] ${event}`, detail);
}
