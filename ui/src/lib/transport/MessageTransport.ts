export interface Transport {
  postMessage(message: any): void;
  onMessage(handler: (event: MessageEvent) => void): void;
  dispose(): void;
  getType(): 'vscode' | 'websocket';
  isConnected(): boolean;
}
