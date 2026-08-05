import type { BaseMessage } from '@shader-studio/types';
import type { Transport, TransportMessage } from './MessageTransport';

export class VSCodeTransport implements Transport {
  private vscode: any;
  private messageHandler?: (event: MessageEvent) => void;

  constructor() {
    this.vscode = acquireVsCodeApi();
  }

  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void {
    this.vscode.postMessage(message);
  }

  onMessage(handler: (event: MessageEvent) => void): void {
    this.messageHandler = handler;
    window.addEventListener('message', this.messageHandler);
  }

  dispose(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = undefined;
    }
  }

  getType(): 'vscode' {
    return 'vscode';
  }

  isConnected(): boolean {
    return !!this.vscode;
  }
}
