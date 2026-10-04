export interface MessageTransport {
  // Transport payloads are a versioned UI protocol shared with independently
  // deployed webviews; command-specific validation happens at each handler.
  send(message: any): void;
  close(): void;
  // See send(): transports only route opaque protocol envelopes.
  onMessage(handler: (message: any) => void): void;
  hasActiveClients(): boolean;
}
