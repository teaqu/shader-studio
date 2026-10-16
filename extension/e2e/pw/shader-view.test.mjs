import test from 'node:test';
import assert from 'node:assert/strict';
import { openShaderView } from './shader-view.mjs';

test('a closing preview iframe cannot suppress opening the next shader view', async () => {
  const commands = [];
  const closingFrame = {
    locator: () => ({ count: async () => 1 }),
  };
  const vscode = {
    // closeAllEditors has disposed the panel, but its iframe is still present.
    window: { frames: () => [closingFrame] },
    evaluateInHost: callback => callback({ commands: {
      executeCommand: async command => commands.push(command),
    } }),
  };
  await openShaderView(vscode);
  assert.deepEqual(commands, ['shader-studio.view']);
});
