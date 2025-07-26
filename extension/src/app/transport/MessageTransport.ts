export interface MessageTransport {
  send(message: any): void;
  close(): void;
  onMessage(handler: (message: any) => void): void;
  hasActiveClients(): boolean;
}
