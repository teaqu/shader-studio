import { afterEach, expect, it, vi } from 'vitest';
import { EditorSourceSession } from '../../lib/editor/EditorSourceSession';
import type { Transport } from '../../lib/transport/MessageTransport';

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const transport = { postMessage: vi.fn(), markEditorDirty: vi.fn() };
  const compile = vi.fn();
  const persisted = vi.fn();
  const session = new EditorSourceSession(transport as unknown as Transport, compile, persisted);
  return { session, transport, compile, persisted };
}
it('debounces persistence and hot compilation to the latest source', () => {
  const { session, transport, compile, persisted } = fixture();
  session.change('/a.glsl', 'a', true);
  session.change('/a.glsl', 'ab', true);
  expect(transport.markEditorDirty).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(15);
  expect(transport.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'updateShaderSource', payload: { path: '/a.glsl', code: 'ab' } });
  expect(persisted).toHaveBeenCalledExactlyOnceWith('ab', '/a.glsl');
  expect(compile).not.toHaveBeenCalled();
  vi.advanceTimersByTime(15);
  expect(compile).toHaveBeenCalledExactlyOnceWith('ab', '/a.glsl');
});
it('flushes the old file before switching and persists manual edits without compiling', () => {
  const { session, transport, compile } = fixture();
  session.change('/a', 'a', true);
  session.change('/b', 'b', false);
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'updateShaderSource', payload: { path: '/a', code: 'a' } });
  session.flush();
  session.flush();
  vi.runAllTimers();
  expect(transport.postMessage).toHaveBeenCalledTimes(2);
  expect(compile).not.toHaveBeenCalled();
});
it('flushes pending text on disposal and cancels timers', () => {
  const { session, transport, compile } = fixture();
  session.change('/a', 'a', true);
  session.dispose();
  session.dispose();
  vi.runAllTimers();
  expect(transport.postMessage).toHaveBeenCalledTimes(1);
  expect(compile).not.toHaveBeenCalled();
});
it('ignores anonymous documents and supports hosts without dirty notifications', () => {
  const { session, transport } = fixture();
  session.change('', 'a', true);
  vi.runAllTimers();
  expect(transport.postMessage).not.toHaveBeenCalled();
  const minimal = new EditorSourceSession({ postMessage: transport.postMessage } as unknown as Transport, vi.fn(), vi.fn());
  minimal.change('/b', '', false);
  minimal.dispose();
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'updateShaderSource', payload: { path: '/b', code: '' } });
});
