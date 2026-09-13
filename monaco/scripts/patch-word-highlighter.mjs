import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function patchWordHighlighter(source) {
  // Monaco 0.55.1 leaves these fire-and-forget Delayer promises unhandled.
  // Switching models or restoring a view cancels the delay. Use Monaco's own
  // cancellation-aware handler, which still reports every unexpected error.
  const calls = source.match(/this\.runDelayer\.trigger\([^\n]+/g) ?? [];
  if (calls.length !== 3 || calls.some(call => !/\);(?:\s*)$/.test(call))) {
    throw new Error('Unrecognized Monaco word-highlighter implementation; review the cancellation patch.');
  }
  return source.replace(/(this\.runDelayer\.trigger\([^\n]+\))(;)[ \t]*$/gm, (statement, call) =>
    call.endsWith('.catch(onUnexpectedError)') ? statement : `${call}.catch(onUnexpectedError);`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const path = require.resolve('monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js');
  const source = readFileSync(path, 'utf8');
  const patched = patchWordHighlighter(source);
  if (patched !== source) writeFileSync(path, patched);
}
