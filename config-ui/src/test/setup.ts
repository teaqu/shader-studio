import { vi } from 'vitest';
import '@testing-library/jest-dom';

(global as any).acquireVsCodeApi = vi.fn(() => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn()
}));

const messageHandlers = new Map();
(global as any).addEventListener = vi.fn((event: string, handler: any) => {
  if (event === 'message') {
    messageHandlers.set(handler, handler);
  }
});

(global as any).removeEventListener = vi.fn((event: string, handler: any) => {
  if (event === 'message') {
    messageHandlers.delete(handler);
  }
});

export function simulateVSCodeMessage(data: any) {
  const event = {
    data: data,
    origin: '*',
    source: window
  };
  
  messageHandlers.forEach(handler => {
    handler(event);
  });
}

export function createMockConfig(config: any) {
  return {
    type: 'update',
    text: JSON.stringify(config)
  };
}

export function createMockError(error: string) {
  return {
    type: 'update',
    text: error
  };
}
