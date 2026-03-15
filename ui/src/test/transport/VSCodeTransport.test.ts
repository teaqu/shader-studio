import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VSCodeTransport } from '../../lib/transport/VSCodeTransport';

const mockVSCodeApi = {
  postMessage: vi.fn(),
};

// Mock acquireVsCodeApi globally
(globalThis as any).acquireVsCodeApi = vi.fn(() => mockVSCodeApi);

describe('VSCodeTransport', () => {
  let transport: VSCodeTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new VSCodeTransport();
  });

  describe('constructor', () => {
    it('should call acquireVsCodeApi', () => {
      expect(acquireVsCodeApi).toHaveBeenCalled();
    });
  });

  describe('postMessage', () => {
    it('should forward message to vscode api', () => {
      const message = { type: 'test', data: 'hello' };
      transport.postMessage(message);
      expect(mockVSCodeApi.postMessage).toHaveBeenCalledWith(message);
    });

    it('should handle multiple messages', () => {
      transport.postMessage({ type: 'a' });
      transport.postMessage({ type: 'b' });
      expect(mockVSCodeApi.postMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('onMessage', () => {
    it('should add event listener on window', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const handler = vi.fn();
      transport.onMessage(handler);
      expect(addSpy).toHaveBeenCalledWith('message', handler);
      addSpy.mockRestore();
    });

    it('should store the handler for later removal', () => {
      const handler = vi.fn();
      transport.onMessage(handler);
      // Verify by calling dispose and checking removeEventListener
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      transport.dispose();
      expect(removeSpy).toHaveBeenCalledWith('message', handler);
      removeSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('should remove the message handler', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const handler = vi.fn();
      transport.onMessage(handler);
      transport.dispose();
      expect(removeSpy).toHaveBeenCalledWith('message', handler);
      removeSpy.mockRestore();
    });

    it('should not throw if no handler was registered', () => {
      expect(() => transport.dispose()).not.toThrow();
    });

    it('should clear the handler so subsequent dispose is a no-op', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const handler = vi.fn();
      transport.onMessage(handler);
      transport.dispose();
      transport.dispose();
      // removeEventListener should only be called once
      expect(removeSpy).toHaveBeenCalledTimes(1);
      removeSpy.mockRestore();
    });
  });

  describe('getType', () => {
    it('should return vscode', () => {
      expect(transport.getType()).toBe('vscode');
    });
  });

  describe('isConnected', () => {
    it('should return true when vscode api is available', () => {
      expect(transport.isConnected()).toBe(true);
    });
  });

});
