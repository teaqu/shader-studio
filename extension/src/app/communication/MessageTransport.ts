export interface MessageTransport {
  send(message: any): void;
  convertUriForClient(filePath: string): string;
  close(): void;
  onMessage(handler: (message: any) => void): void;
}
