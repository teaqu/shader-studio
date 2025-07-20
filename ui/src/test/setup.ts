import { vi } from 'vitest';

Object.defineProperty(window, 'HTMLCanvasElement', {
  value: class HTMLCanvasElement {
    width = 800;
    height = 600;
    
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: this.width,
        height: this.height,
        right: this.width,
        bottom: this.height
      };
    }
    
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
  }
});

if (!window.addEventListener) {
  window.addEventListener = vi.fn();
  window.removeEventListener = vi.fn();
}
