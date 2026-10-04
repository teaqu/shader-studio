import type { WgslTraceLaunch } from '@shader-studio/types';
import { captureWgslTrace } from './WgslTraceCapture';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const host = acquireVsCodeApi();
const controller = new AbortController();
let started = false;
window.addEventListener('message', async (event: MessageEvent<{ type: string; launch: WgslTraceLaunch }>) => {
  if (event.data.type !== 'captureWgslTrace' || started) {
    return;
  }
  started = true;
  const status = document.getElementById('status')!;
  status.textContent = 'Recording shader execution on the GPU…';
  try {
    const recording = await captureWgslTrace(event.data.launch, controller.signal);
    status.textContent = `Captured ${recording.events.length} steps${recording.overflow ? ' (recording limit reached)' : ''}. Use the VS Code debug toolbar to step through mainImage. Closing this panel ends the session.`;
    host.postMessage({ type: 'wgslTraceResult', recording });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = message;
    host.postMessage({ type: 'wgslTraceError', message });
  }
});
window.addEventListener('pagehide', () => controller.abort());
host.postMessage({ type: 'wgslTraceReady' });
