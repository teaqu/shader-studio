import { describe, it, expect } from 'vitest';

// Test the buffer name extraction logic separately
describe('Buffer Name Extraction Tests', () => {
  
  function extractBufferNameFromPath(path: string): string | null {
    // Extract filename without extension from path
    const filename = path.split(/[\\/]/).pop(); // Get last part of path
    if (!filename) {
      return null;
    }
    
    // Remove extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    return nameWithoutExt;
  }

  it('should extract buffer name from Windows path', () => {
    const path = 'c:\\Users\\calum\\Projects\\shaders\\shadertoy\\src\\2d\\gol\\gol-buffer.glsl';
    const bufferName = extractBufferNameFromPath(path);
    expect(bufferName).toBe('gol-buffer');
  });

  it('should extract buffer name from Unix path', () => {
    const path = '/home/user/shaders/buffer.glsl';
    const bufferName = extractBufferNameFromPath(path);
    expect(bufferName).toBe('buffer');
  });

  it('should handle simple filename', () => {
    const path = 'BufferA.glsl';
    const bufferName = extractBufferNameFromPath(path);
    expect(bufferName).toBe('BufferA');
  });

  it('should handle multiple dots in filename', () => {
    const path = 'my.complex.buffer.name.glsl';
    const bufferName = extractBufferNameFromPath(path);
    expect(bufferName).toBe('my.complex.buffer.name');
  });

  it('should return null for empty path', () => {
    const path = '';
    const bufferName = extractBufferNameFromPath(path);
    expect(bufferName).toBeNull();
  });

  it('should handle path ending with slash', () => {
    const path = 'c:\\path\\to\\';
    const bufferName = extractBufferNameFromPath(path);
    expect(bufferName).toBeNull();
  });
});
