import { describe, expect, it, vi } from 'vitest';
import { McpEditGuard } from '../../src/app/mcp/McpEditGuard';

describe('McpEditGuard', () => {
  it('suppresses duplicate matching events for an update', () => {
    const guard = new McpEditGuard();
    guard.arm('/workspace/pass.glsl', 'new text', '/workspace/main.glsl');
    expect(guard.take('/workspace/pass.glsl', 'new text')).toBe('/workspace/main.glsl');
    expect(guard.take('/workspace/pass.glsl', 'new text')).toBe('/workspace/main.glsl');
  });

  it('clears stale mismatches and explicit cancellations', () => {
    const guard = new McpEditGuard();
    guard.arm('/workspace/pass.glsl', 'expected', '/workspace/main.glsl');
    expect(guard.take('/workspace/pass.glsl', 'other')).toBeUndefined();
    guard.arm('/workspace/pass.glsl', 'expected', '/workspace/main.glsl');
    guard.clear('/workspace/pass.glsl');
    expect(guard.take('/workspace/pass.glsl', 'expected')).toBeUndefined();
  });

  it('expires an unobserved edit', () => {
    vi.useFakeTimers();
    const guard = new McpEditGuard(5);
    guard.arm('/workspace/pass.glsl', 'expected', '/workspace/main.glsl');
    vi.advanceTimersByTime(5);
    expect(guard.take('/workspace/pass.glsl', 'expected')).toBeUndefined();
    vi.useRealTimers();
  });

  it('suppresses only the expected create-and-insert sequence', () => {
    vi.useFakeTimers();
    const guard = new McpEditGuard();
    guard.armSuppression('/workspace/new.glsl', 'new shader', 5);
    expect(guard.take('/workspace/new.glsl', '')).toBe('');
    expect(guard.take('/workspace/new.glsl', 'new shader')).toBe('');
    expect(guard.take('/workspace/new.glsl', 'new shader')).toBe('');
    expect(guard.take('/workspace/new.glsl', '')).toBeUndefined();
    expect(guard.take('/workspace/new.glsl', 'new shader')).toBeUndefined();
    vi.useRealTimers();
  });

  it('does not suppress text unrelated to a pending create', () => {
    vi.useFakeTimers();
    const guard = new McpEditGuard();
    guard.armSuppression('/workspace/new.glsl', 'new shader', 5);
    expect(guard.take('/workspace/new.glsl', 'user edit')).toBeUndefined();
    vi.advanceTimersByTime(5);
    expect(guard.take('/workspace/new.glsl', 'new shader')).toBeUndefined();
    vi.useRealTimers();
  });
});
