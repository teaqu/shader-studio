import type { Transport } from './MessageTransport';
import { VSCodeTransport } from './VSCodeTransport';
import { WebSocketTransport } from './WebSocketTransport';

export function createTransport(): Transport {
  const isVSCodeContext = typeof acquireVsCodeApi !== 'undefined';

  if (isVSCodeContext) {
    return new VSCodeTransport();
  } else {
    return new WebSocketTransport();
  }
}

export function isVSCodeEnvironment(): boolean {
  return typeof acquireVsCodeApi !== 'undefined';
}
