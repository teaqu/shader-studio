import type { Transport } from './MessageTransport';
import { VSCodeTransport } from './VSCodeTransport';
import { WebSocketTransport } from './WebSocketTransport';

export function createTransport(): Transport {
  const isVSCodeContext = typeof acquireVsCodeApi !== 'undefined';

  if (isVSCodeContext) {
    console.log('Creating VSCode transport');
    return new VSCodeTransport();
  } else {
    console.log('Creating WebSocket transport');
    return new WebSocketTransport();
  }
}

export function isVSCodeEnvironment(): boolean {
  return typeof acquireVsCodeApi !== 'undefined';
}

export function isWebSocketSupported(): boolean {
  return typeof WebSocket !== 'undefined';
}
