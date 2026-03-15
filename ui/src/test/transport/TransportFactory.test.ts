import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the transport modules before importing the factory
vi.mock('../../lib/transport/VSCodeTransport', () => ({
  VSCodeTransport: vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: vi.fn().mockReturnValue('vscode'),
    isConnected: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock('../../lib/transport/WebSocketTransport', () => ({
  WebSocketTransport: vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: vi.fn().mockReturnValue('websocket'),
    isConnected: vi.fn().mockReturnValue(true),
  })),
}));

import { createTransport, isVSCodeEnvironment } from '../../lib/transport/TransportFactory';
import { VSCodeTransport } from '../../lib/transport/VSCodeTransport';
import { WebSocketTransport } from '../../lib/transport/WebSocketTransport';

describe('TransportFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up global
    delete (globalThis as any).acquireVsCodeApi;
  });

  describe('createTransport', () => {
    it('should create VSCodeTransport when acquireVsCodeApi is defined', () => {
      (globalThis as any).acquireVsCodeApi = vi.fn();
      const transport = createTransport();
      expect(VSCodeTransport).toHaveBeenCalled();
      expect(transport.getType()).toBe('vscode');
    });

    it('should create WebSocketTransport when acquireVsCodeApi is not defined', () => {
      delete (globalThis as any).acquireVsCodeApi;
      const transport = createTransport();
      expect(WebSocketTransport).toHaveBeenCalled();
      expect(transport.getType()).toBe('websocket');
    });
  });

  describe('isVSCodeEnvironment', () => {
    it('should return true when acquireVsCodeApi is defined', () => {
      (globalThis as any).acquireVsCodeApi = vi.fn();
      expect(isVSCodeEnvironment()).toBe(true);
    });

    it('should return false when acquireVsCodeApi is not defined', () => {
      delete (globalThis as any).acquireVsCodeApi;
      expect(isVSCodeEnvironment()).toBe(false);
    });
  });

});
