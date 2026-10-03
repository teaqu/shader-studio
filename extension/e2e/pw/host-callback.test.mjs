import assert from 'node:assert/strict';
import test from 'node:test';
import { hostCallbackId, hostCallbackSource } from './host-callback.mjs';

test('static callback identity is independent of checkout line endings', () => {
  const source = '(vscode) => {\n  return vscode.window.activeTextEditor;\n}';
  assert.equal(hostCallbackId(source), hostCallbackId(source.replaceAll('\n', '\r\n')));
  assert.equal(hostCallbackSource(source.replaceAll('\n', '\r\n')), source);
});

test('normalization preserves escaped text and distinguishes executable changes', () => {
  const source = '() => "\\r\\n"';
  assert.equal(hostCallbackSource(source), source);
  assert.notEqual(hostCallbackId('() => 1'), hostCallbackId('() => 2'));
  assert.notEqual(hostCallbackId('() => "a\\r\\nb"'), hostCallbackId('() => "a\\nb"'));
});
