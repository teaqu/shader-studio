import { createHash } from 'node:crypto';

export function hostCallbackSource(source) {
  return source.replace(/\r\n/g, '\n');
}

export function hostCallbackId(source) {
  return createHash('sha256').update(hostCallbackSource(source)).digest('hex');
}
