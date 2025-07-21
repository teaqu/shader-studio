import type { Transport } from './MessageTransport';

export class VSCodeTransport implements Transport {
  private vscode: any;
  private messageHandler?: (event: MessageEvent) => void;

  constructor() {
    this.vscode = acquireVsCodeApi();
  }

  postMessage(message: any): void {
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

  getVSCodeAPI(): any {
    return this.vscode;
  }
}
