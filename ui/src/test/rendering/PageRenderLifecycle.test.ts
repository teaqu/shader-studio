import { describe, expect, it, vi } from 'vitest';
import { PageRenderLifecycle } from '../../lib/rendering/PageRenderLifecycle';

describe('PageRenderLifecycle', () => {
  it('stops in the background and resumes without changing pause state', () => {
    let listener: (() => void) | undefined;
    const page = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: vi.fn((_name: string, next: EventListenerOrEventListenerObject) => {
        listener = next as () => void;
      }),
      removeEventListener: vi.fn(),
    };
    const engine = { startRenderLoop: vi.fn(), stopRenderLoop: vi.fn() };
    const lifecycle = new PageRenderLifecycle(page, () => engine);

    page.visibilityState = 'hidden';
    listener?.();
    expect(engine.stopRenderLoop).toHaveBeenCalledOnce();
    expect(engine.startRenderLoop).not.toHaveBeenCalled();

    page.visibilityState = 'visible';
    listener?.();
    expect(engine.startRenderLoop).toHaveBeenCalledOnce();

    lifecycle.dispose();
    expect(page.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('does nothing before an engine exists', () => {
    let listener: (() => void) | undefined;
    const page = {
      visibilityState: 'hidden' as DocumentVisibilityState,
      addEventListener: vi.fn((_name: string, next: EventListenerOrEventListenerObject) => {
        listener = next as () => void;
      }),
      removeEventListener: vi.fn(),
    };
    const lifecycle = new PageRenderLifecycle(page, () => null);
    expect(() => listener?.()).not.toThrow();
    lifecycle.dispose();
  });

  it('removes exactly the listener it added', () => {
    const page = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const lifecycle = new PageRenderLifecycle(page, () => null);

    lifecycle.dispose();

    expect(page.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(page.removeEventListener.mock.calls[0][1]).toBe(page.addEventListener.mock.calls[0][1]);
  });

  it('looks up the engine at each change, so an engine created later is still paused', () => {
    let listener: (() => void) | undefined;
    const page = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: vi.fn((_name: string, next: EventListenerOrEventListenerObject) => {
        listener = next as () => void;
      }),
      removeEventListener: vi.fn(),
    };
    let engine: { startRenderLoop: () => void; stopRenderLoop: ReturnType<typeof vi.fn<() => void>> } | null = null;
    new PageRenderLifecycle(page, () => engine);
    engine = { startRenderLoop: vi.fn<() => void>(), stopRenderLoop: vi.fn<() => void>() };

    page.visibilityState = 'hidden';
    listener?.();

    expect(engine.stopRenderLoop).toHaveBeenCalledOnce();
  });
});
