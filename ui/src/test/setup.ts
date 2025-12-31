// Test setup: provide minimal browser globals missing in Node/jsdom environments
// Polyfill localStorage if not available or if it doesn't implement getItem/setItem
(
  () => {
    try {
      const g: any = globalThis as any;
      if (!g.localStorage || typeof g.localStorage.getItem !== 'function' || typeof g.localStorage.setItem !== 'function') {
        const store: Record<string, string> = {};
        g.localStorage = {
          getItem(key: string) {
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
          },
          setItem(key: string, value: string) {
            store[key] = String(value);
          },
          removeItem(key: string) {
            delete store[key];
          },
          clear() {
            for (const k of Object.keys(store)) delete store[k];
          }
        };
      }
    } catch (e) {
      // Swallow - tests shouldn't fail due to setup
    }
  }
)();
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock VS Code API
(global as any).acquireVsCodeApi = vi.fn(() => ({
  postMessage: vi.fn(),
  getState: vi.fn(() => ({})),
  setState: vi.fn()
}));

// Mock window.piRequestFullScreen for our fullscreen tests
(global as any).piRequestFullScreen = vi.fn();
