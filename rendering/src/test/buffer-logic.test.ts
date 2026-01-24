import { describe, it, expect } from 'vitest';

describe('Buffer Update Logic Tests', () => {
  
  function extractBufferNameFromPath(path: string): string | null {
    const filename = path.split(/[\\/]/).pop();
    if (!filename) return null;
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    return nameWithoutExt || null;
  }

  function updateBuffersInConfig(
    currentBuffers: Record<string, string>,
    bufferName: string,
    newContent: string
  ): Record<string, string> {
    return {
      ...currentBuffers,
      [bufferName]: newContent
    };
  }

  it('should extract buffer name from path correctly', () => {
    expect(extractBufferNameFromPath('c:\\path\\to\\buffer.glsl')).toBe('buffer');
    expect(extractBufferNameFromPath('/path/to/BufferA.glsl')).toBe('BufferA');
    expect(extractBufferNameFromPath('complex-buffer-name.test.glsl')).toBe('complex-buffer-name.test');
  });

  it('should update specific buffer while preserving others', () => {
    const currentBuffers = {
      'BufferA': 'old content A',
      'BufferB': 'old content B',
      'BufferC': 'old content C'
    };

    const updated = updateBuffersInConfig(currentBuffers, 'BufferB', 'new content B');

    expect(updated.BufferA).toBe('old content A'); // unchanged
    expect(updated.BufferB).toBe('new content B'); // updated
    expect(updated.BufferC).toBe('old content C'); // unchanged
  });

  it('should handle adding new buffer', () => {
    const currentBuffers = {
      'BufferA': 'content A'
    };

    const updated = updateBuffersInConfig(currentBuffers, 'BufferB', 'content B');

    expect(updated.BufferA).toBe('content A');
    expect(updated.BufferB).toBe('content B');
  });
});
