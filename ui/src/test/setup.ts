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
