import type { Transport } from './MessageTransport';
import { WebTransport } from './WebTransport';
import { VSCodeTransport } from './VSCodeTransport';
import { WebSocketTransport } from './WebSocketTransport';

export function createTransport(): Transport {
  const isVSCodeContext = typeof acquireVsCodeApi !== 'undefined';

  if (isVSCodeContext) {
    return new VSCodeTransport();
  }

  if (import.meta.env.VITE_SHADER_STUDIO_WEB === 'true') {
    return new WebTransport();
  }

  return new WebSocketTransport();
}

export function isVSCodeEnvironment(): boolean {
  return typeof acquireVsCodeApi !== 'undefined';
}
