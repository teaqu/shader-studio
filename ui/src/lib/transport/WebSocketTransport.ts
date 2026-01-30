import type { Transport } from './MessageTransport';

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageHandler?: (event: MessageEvent) => void;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const port = this.getPort();
    this.url = `ws://localhost:${port}`;
    this.connect();
  }

  private url: string;

  private getPort(): number {
    if (typeof window !== 'undefined' && (window as any).shaderViewConfig?.port) {
      const port = (window as any).shaderViewConfig.port;
      console.log(`WebSocket: Using port from config: ${port}`);
      return port;
    }

    console.log('WebSocket: Using default port: 51472');
    return 51472;
  }

  private connect(): void {
    try {
      console.log(`WebSocket: Attempting to connect to ${this.url}`);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected successfully');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        this.sendClientInfo();
      };

      this.ws.onmessage = (event) => {

        const data = JSON.parse(event.data);

        if (this.messageHandler) {
          const messageEvent = new MessageEvent('message', {
            data: data
          });

          try {
            this.messageHandler(messageEvent);
          } catch (handlerError) {
            console.error('WebSocket: Error in message handler:', handlerError);
            console.error('WebSocket: Handler error stack:', handlerError instanceof Error ? handlerError.stack : 'No stack');
            console.error('WebSocket: Message that caused error:', data);
          }
        }
      };

      this.ws.onclose = (event) => {
        console.log(`WebSocket disconnected - Code: ${event.code}, Reason: ${event.reason || 'No reason'}, Clean: ${event.wasClean}`);
        this.connected = false;

        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connected = false;
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
    }, this.reconnectDelay);
  }

  private sendClientInfo(): void {
    this.postMessage({
      type: 'clientInfo',
      userAgent: navigator.userAgent
    });

    console.log(`WebSocket: Sent client info`);
  }

  postMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const messageStr = JSON.stringify(message);
        this.ws.send(messageStr);
      } catch (error) {
        console.error('WebSocket: Error sending message:', error);
        console.error('Message that failed:', message);
      }
    } else {
      console.warn('WebSocket not connected. Message not sent:', message);
    }
  }

  onMessage(handler: (event: MessageEvent) => void): void {
    this.messageHandler = handler;
  }

  dispose(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandler = undefined;
    this.connected = false;
  }

  getType(): 'websocket' {
    return 'websocket';
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  reconnect(): void {
    this.dispose();
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.connect();
  }
}
