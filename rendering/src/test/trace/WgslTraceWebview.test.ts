import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../../trace/WgslTraceCapture', () => ({ captureWgslTrace: capture }));

describe('source-only trace webview host bridge', () => {
  const handlers = new Map<string, EventListenerOrEventListenerObject>();
  let status: HTMLDivElement;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    capture.mockReset();
    handlers.clear();
    postMessage = vi.fn();
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (listener) {
        handlers.set(type, listener);
      }
    });
    status = document.createElement('div'); status.id = 'status'; document.body.append(status);
    await import('../../trace/WgslTraceWebview');
  });

  afterEach(() => {
    status.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function message(type: string) {
    const handler = handlers.get('message') as (event: unknown) => Promise<void>;
    await handler({ data: { type, launch: { source: 'shader' } } });
  }

  it.each([false, true])('announces readiness and forwards an immutable recording (overflow %s)', async (overflow) => {
    const recording = { events: [{ line: 1 }], overflow };
    capture.mockResolvedValue(recording);
    expect(postMessage).toHaveBeenCalledWith({ type: 'wgslTraceReady' });
    await message('unrelated');
    expect(capture).not.toHaveBeenCalled();
    await message('captureWgslTrace');
    expect(postMessage).toHaveBeenCalledWith({ type: 'wgslTraceResult', recording });
    expect(status.textContent).toContain('Captured 1 steps');
    expect(status.textContent?.includes('recording limit reached')).toBe(overflow);
    await message('captureWgslTrace');
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('GPU failed'), 'GPU failed'])('reports capture errors without allowing a duplicate launch', async (error) => {
    capture.mockRejectedValue(error);
    await message('captureWgslTrace');
    expect(status.textContent).toBe('GPU failed');
    expect(postMessage).toHaveBeenCalledWith({ type: 'wgslTraceError', message: 'GPU failed' });
    await message('captureWgslTrace');
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('cancels the active GPU capture when the panel closes', async () => {
    capture.mockResolvedValue({ events: [], overflow: false });
    await message('captureWgslTrace');
    const signal = capture.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    (handlers.get('pagehide') as () => void)();
    expect(signal.aborted).toBe(true);
  });
});
