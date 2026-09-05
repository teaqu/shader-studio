import type { Transport } from './MessageTransport';
import { VSCodeTransport } from './VSCodeTransport';
import { WebSocketTransport } from './WebSocketTransport';
import { getHostTransportFactory } from '../state/hostState.svelte';

export function createTransport(): Transport {
  const isVSCodeContext = typeof acquireVsCodeApi !== 'undefined';

  if (isVSCodeContext) {
    return new VSCodeTransport();
  }

  // A host that embeds the viewer (such as the standalone web shell) supplies
  // its own transport; otherwise the viewer talks to the extension's server.
  const hostTransport = getHostTransportFactory();
  if (hostTransport) {
    return hostTransport();
  }

  return new WebSocketTransport();
}

export function isVSCodeEnvironment(): boolean {
  return typeof acquireVsCodeApi !== 'undefined';
}
