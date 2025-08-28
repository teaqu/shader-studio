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

    send(data: any) {
    }

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
}

describe('WebSocketTransport Port Configuration', () => {
    let originalWebSocket: any;
    let originalWindow: any;
    let consoleLogSpy: any;
    let webSocketSpy: any;

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
        global.window = {} as any;
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        global.WebSocket = originalWebSocket;
        global.window = originalWindow;
        consoleLogSpy.mockRestore();
    });

    describe('Port Configuration', () => {
        it('should use port from shaderViewConfig when available', () => {
            const testPort = 8080;
            (global.window as any).shaderViewConfig = { port: testPort };

            const transport = new WebSocketTransport();

            expect(consoleLogSpy).toHaveBeenCalledWith(`WebSocket: Using port from config: ${testPort}`);
            expect(webSocketSpy).toHaveBeenCalledWith(`ws://localhost:${testPort}`);
        });

        it('should use default port when shaderViewConfig is not available', () => {
            const transport = new WebSocketTransport();

            expect(consoleLogSpy).toHaveBeenCalledWith('WebSocket: Using default port: 51472');
            expect(webSocketSpy).toHaveBeenCalledWith('ws://localhost:51472');
        });

        it('should use port from shaderViewConfig with different port values', () => {
            const testPort = 9090;
            (global.window as any).shaderViewConfig = { port: testPort };

            const transport = new WebSocketTransport();

            expect(consoleLogSpy).toHaveBeenCalledWith(`WebSocket: Using port from config: ${testPort}`);
            expect(webSocketSpy).toHaveBeenCalledWith(`ws://localhost:${testPort}`);
        });
    });
});
