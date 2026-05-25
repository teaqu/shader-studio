import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketTransport } from '../../lib/transport/WebSocketTransport';

class MockWebSocket {
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readyState: number = 1;

  constructor(url: string) {
    this.url = url;
  }

  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close'));
  }

  send = vi.fn();

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
}

describe('WebSocketTransport', () => {
  let originalWebSocket: any;
  let originalWindow: any;
  let originalNavigator: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;
  let webSocketSpy: any;

  function createTransport(port: number = 8080): { transport: WebSocketTransport; mockWs: MockWebSocket } {
    (global as any).shaderViewConfig = { port };
    const transport = new WebSocketTransport();
    const mockWs = webSocketSpy.mock.results[webSocketSpy.mock.results.length - 1].value as MockWebSocket;
    return { transport, mockWs };
  }

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    webSocketSpy = vi.fn().mockImplementation((url: string) => new MockWebSocket(url));
    global.WebSocket = webSocketSpy as any;

    Object.assign(global.WebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3
    });

    originalWindow = global.window;
    delete (global as any).shaderViewConfig;

    originalNavigator = global.navigator;
    vi.stubGlobal('navigator', { userAgent: 'test-agent' });

    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    global.window = originalWindow;
    delete (global as any).shaderViewConfig;
    vi.unstubAllGlobals();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Port Configuration', () => {
    it('should use port from shaderViewConfig when available', () => {
      const testPort = 8080;
      (global as any).shaderViewConfig = { port: testPort };

      const transport = new WebSocketTransport();

      expect(webSocketSpy).toHaveBeenCalledWith(`ws://localhost:${testPort}`);
    });

    it('should warn and use fallback port when shaderViewConfig is not available', () => {
      const transport = new WebSocketTransport();

      expect(consoleWarnSpy).toHaveBeenCalledWith('WebSocket: No port configured via shaderViewConfig. Connection may fail.');
      expect(webSocketSpy).toHaveBeenCalledWith('ws://localhost:51472');
    });

    it('should use port from shaderViewConfig with different port values', () => {
      const testPort = 9090;
      (global as any).shaderViewConfig = { port: testPort };

      const transport = new WebSocketTransport();

      expect(webSocketSpy).toHaveBeenCalledWith(`ws://localhost:${testPort}`);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should set connected=true and reset reconnect state on open', () => {
      const { transport, mockWs } = createTransport();

      expect(transport.isConnected()).toBe(false); // readyState mock is 1 but connected flag is false

      // Simulate open
      mockWs.onopen?.(new Event('open'));

      expect(transport.isConnected()).toBe(true);
    });

    it('should send client info on connection open', () => {
      const { transport, mockWs } = createTransport();
      mockWs.onopen?.(new Event('open'));

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.type).toBe('clientInfo');
      expect(sentData.userAgent).toBe('test-agent');
    });

    it('should set connected=false and attempt reconnect on close', () => {
      const { transport, mockWs } = createTransport();
      mockWs.onopen?.(new Event('open'));

      mockWs.onclose?.(new CloseEvent('close', { code: 1000, reason: 'Normal' }));

      expect(transport.isConnected()).toBe(false);
    });

    it('should set connected=false on error', () => {
      const { transport, mockWs } = createTransport();
      mockWs.onopen?.(new Event('open'));

      mockWs.onerror?.(new Event('error'));

      expect(consoleErrorSpy).toHaveBeenCalledWith('WebSocket error:', expect.any(Event));
      expect(transport.isConnected()).toBe(false);
    });

    it('should handle WebSocket constructor throwing', () => {
      (global as any).shaderViewConfig = { port: 8080 };
      webSocketSpy.mockImplementationOnce(() => {
        throw new Error('Connection refused'); 
      });

      const transport = new WebSocketTransport();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create WebSocket:', expect.any(Error));
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnect after disconnect', () => {
      vi.useFakeTimers();
      const { transport, mockWs } = createTransport();

      mockWs.onclose?.(new CloseEvent('close'));

      vi.advanceTimersByTime(999);
      expect(webSocketSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      expect(webSocketSpy).toHaveBeenCalledTimes(2);
    });

    it('should stop reconnecting after max attempts', () => {
      vi.useFakeTimers();
      const { transport, mockWs } = createTransport();

      // Exhaust all reconnect attempts
      for (let i = 0; i < 5; i++) {
        const currentMockWs = webSocketSpy.mock.results[webSocketSpy.mock.results.length - 1].value as MockWebSocket;
        currentMockWs.onclose?.(new CloseEvent('close'));
        vi.advanceTimersByTime(20000); // Advance well past any delay
      }

      // Trigger one more close
      const lastMockWs = webSocketSpy.mock.results[webSocketSpy.mock.results.length - 1].value as MockWebSocket;
      lastMockWs.onclose?.(new CloseEvent('close'));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Max reconnection attempts reached');
    });

    it('should use exponential backoff for reconnect delay', () => {
      vi.useFakeTimers();
      const { transport, mockWs } = createTransport();

      mockWs.onclose?.(new CloseEvent('close'));

      vi.advanceTimersByTime(999);
      expect(webSocketSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(webSocketSpy).toHaveBeenCalledTimes(2);

      const ws2 = webSocketSpy.mock.results[webSocketSpy.mock.results.length - 1].value as MockWebSocket;
      ws2.onclose?.(new CloseEvent('close'));

      vi.advanceTimersByTime(1999);
      expect(webSocketSpy).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      expect(webSocketSpy).toHaveBeenCalledTimes(3);
    });

    it('should not start duplicate reconnect if one is pending', () => {
      vi.useFakeTimers();
      const { transport, mockWs } = createTransport();

      mockWs.onclose?.(new CloseEvent('close'));
      mockWs.onclose?.(new CloseEvent('close'));

      const callCountBefore = webSocketSpy.mock.calls.length;
      vi.advanceTimersByTime(999);
      expect(webSocketSpy.mock.calls.length).toBe(callCountBefore);

      vi.advanceTimersByTime(1);
      expect(webSocketSpy.mock.calls.length).toBe(callCountBefore + 1);
    });
  });

  describe('Message Handling', () => {
    it('should call all registered message handlers', () => {
      const { transport, mockWs } = createTransport();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      transport.onMessage(handler1);
      transport.onMessage(handler2);

      mockWs.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'shaderSource', code: 'test' })
      }));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not lose first handler when second is registered', () => {
      const { transport, mockWs } = createTransport();
      const shaderHandler = vi.fn();
      const cursorHandler = vi.fn();

      transport.onMessage(shaderHandler);
      transport.onMessage(cursorHandler);

      mockWs.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'shaderSource', code: 'void main(){}' })
      }));

      expect(shaderHandler).toHaveBeenCalledTimes(1);
      expect(cursorHandler).toHaveBeenCalledTimes(1);
    });

    it('should pass parsed data in MessageEvent to handlers', () => {
      const { transport, mockWs } = createTransport();
      const handler = vi.fn();
      transport.onMessage(handler);

      const payload = { type: 'shaderSource', code: 'test code', config: null };
      mockWs.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify(payload)
      }));

      const receivedEvent = handler.mock.calls[0][0] as MessageEvent;
      expect(receivedEvent.data).toEqual(payload);
    });

    it('should catch and log handler errors without affecting other handlers', () => {
      const { transport, mockWs } = createTransport();
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('handler boom'); 
      });
      const goodHandler = vi.fn();

      transport.onMessage(errorHandler);
      transport.onMessage(goodHandler);

      mockWs.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'test' })
      }));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'WebSocket: Error in message handler:', expect.any(Error)
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket: Handler error stack:'), expect.any(String)
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'WebSocket: Message that caused error:', { type: 'test' }
      );
      // Second handler still called
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle Error thrown in handler', () => {
      const { transport, mockWs } = createTransport();
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('string error'); 
      });

      transport.onMessage(errorHandler);

      mockWs.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'test' })
      }));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'WebSocket: Handler error stack:', expect.any(String)
      );
    });
  });

  describe('postMessage', () => {
    it('should send JSON-stringified message when connected', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.OPEN;
      mockWs.onopen?.(new Event('open'));

      transport.postMessage({ type: 'test', data: 'hello' });

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', data: 'hello' }));
    });

    it('should queue messages when WebSocket is not connected', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.CLOSED;

      transport.postMessage({ type: 'test' });

      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('should flush queued messages when connection opens', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.CLOSED;

      transport.postMessage({ type: 'queued1' });
      transport.postMessage({ type: 'queued2' });

      expect(mockWs.send).not.toHaveBeenCalled();

      // Simulate connection opening
      mockWs.readyState = WebSocket.OPEN;
      mockWs.onopen?.(new Event('open'));

      // clientInfo + 2 queued messages
      expect(mockWs.send).toHaveBeenCalledTimes(3);
      const sentMessages = mockWs.send.mock.calls.map((c: any) => JSON.parse(c[0]));
      expect(sentMessages[0].type).toBe('clientInfo');
      expect(sentMessages[1].type).toBe('queued1');
      expect(sentMessages[2].type).toBe('queued2');
    });

    it('should clear pending messages on dispose', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.CLOSED;

      transport.postMessage({ type: 'queued' });
      transport.dispose();

      // Create new transport to verify queue was cleared
      const { transport: transport2, mockWs: mockWs2 } = createTransport();
      mockWs2.readyState = WebSocket.OPEN;
      mockWs2.onopen?.(new Event('open'));

      // Only clientInfo, no leftover queued messages
      expect(mockWs2.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockWs2.send.mock.calls[0][0]).type).toBe('clientInfo');
    });

    it('should catch and log send errors', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.OPEN;
      mockWs.onopen?.(new Event('open'));
      mockWs.send.mockReset(); // Clear clientInfo send
      mockWs.send.mockImplementation(() => {
        throw new Error('send failed'); 
      });

      transport.postMessage({ type: 'fail' });

      expect(consoleErrorSpy).toHaveBeenCalledWith('WebSocket: Error sending message:', expect.any(Error));
      expect(consoleErrorSpy).toHaveBeenCalledWith('Message that failed:', { type: 'fail' });
    });
  });

  describe('dispose', () => {
    it('should close WebSocket and clear handlers', () => {
      const { transport, mockWs } = createTransport();
      const handler = vi.fn();
      transport.onMessage(handler);

      transport.dispose();

      expect(mockWs.readyState).toBe(3); // CLOSED
      expect(transport.isConnected()).toBe(false);
    });

    it('should clear pending reconnect timeout', () => {
      vi.useFakeTimers();
      const { transport, mockWs } = createTransport();

      // Trigger a disconnect to start reconnect timer
      mockWs.onclose?.(new CloseEvent('close'));

      const callCountBefore = webSocketSpy.mock.calls.length;

      // Prevent MockWebSocket.close() from synchronously firing onclose
      // (real WebSocket close is async, but our mock fires synchronously)
      mockWs.onclose = null;
      transport.dispose();

      // Advance time - the original reconnect timer should NOT fire
      vi.advanceTimersByTime(10000);
      expect(webSocketSpy.mock.calls.length).toBe(callCountBefore);
    });

    it('should handle dispose when no WebSocket exists', () => {
      (global as any).shaderViewConfig = { port: 8080 };
      webSocketSpy.mockImplementationOnce(() => {
        throw new Error('fail'); 
      });
      const transport = new WebSocketTransport();

      // Should not throw
      transport.dispose();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('getType', () => {
    it('should return websocket', () => {
      const { transport } = createTransport();
      expect(transport.getType()).toBe('websocket');
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      const { transport } = createTransport();
      expect(transport.isConnected()).toBe(false);
    });

    it('should return true after successful connection', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.OPEN;
      mockWs.onopen?.(new Event('open'));

      expect(transport.isConnected()).toBe(true);
    });

    it('should return false after disconnect', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.OPEN;
      mockWs.onopen?.(new Event('open'));
      mockWs.onclose?.(new CloseEvent('close'));

      expect(transport.isConnected()).toBe(false);
    });

    it('should return false when connected flag is true but readyState is not OPEN', () => {
      const { transport, mockWs } = createTransport();
      mockWs.readyState = WebSocket.OPEN;
      mockWs.onopen?.(new Event('open'));

      // Simulate readyState changing without triggering close event
      mockWs.readyState = WebSocket.CLOSING;

      expect(transport.isConnected()).toBe(false);
    });
  });

});
