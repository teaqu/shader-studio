import type { BaseMessage } from '@shader-studio/types';
import type { Transport, TransportMessage } from './MessageTransport';

export class VSCodeTransport implements Transport {
  private readonly vscode: ReturnType<typeof acquireVsCodeApi>;
  private readonly messageHandlers = new Set<(event: MessageEvent) => void>();

  constructor() {
    this.vscode = acquireVsCodeApi();
  }

  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void {
    this.vscode.postMessage(message);
  }

  onMessage(handler: (event: MessageEvent) => void): void {
    if (this.messageHandlers.has(handler)) {
      return;
    }
    this.messageHandlers.add(handler);
    window.addEventListener('message', handler);
  }

  dispose(): void {
    for (const handler of this.messageHandlers) {
      window.removeEventListener('message', handler);
    }
    this.messageHandlers.clear();
  }

  getType(): 'vscode' {
    return 'vscode';
  }

  isConnected(): boolean {
    return !!this.vscode;
  }
}
