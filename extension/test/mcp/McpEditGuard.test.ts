import { describe, expect, it, vi } from 'vitest';
import { McpEditGuard } from '../../src/app/mcp/McpEditGuard';

describe('McpEditGuard', () => {
  it('matches Windows document paths regardless of drive and filename casing', () => {
    const guard = new McpEditGuard(1000, 'win32');
    guard.armSuppression('C:\\Workspace\\New.glsl', 'new shader');
    expect(guard.take('c:\\workspace\\new.glsl', '')).toBe('');
    expect(guard.take('c:/workspace/new.glsl', 'new shader')).toBe('');
    guard.clear('c:\\WORKSPACE\\new.glsl');
    expect(guard.take('C:\\Workspace\\New.glsl', 'new shader')).toBeUndefined();
  });

  it('keeps POSIX paths case-sensitive', () => {
    const guard = new McpEditGuard(1000, 'linux');
    guard.arm('/workspace/A.glsl', 'text', '/workspace/main.glsl');
    expect(guard.take('/workspace/a.glsl', 'text')).toBeUndefined();
    expect(guard.take('/workspace/A.glsl', 'text')).toBe('/workspace/main.glsl');
    guard.clear('/workspace/A.glsl');
  });
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
