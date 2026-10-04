import { defineProject } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pure extension units run in Node; VS Code API integration remains in the
// existing extension-host suite. This project supplies Istanbul counters too.
export default defineProject({
  resolve: { alias: { vscode: fileURLToPath(new URL('./src/test/unit/vscodeStub.mts', import.meta.url)) } },
  test: {
    name: 'extension-units',
    environment: 'node',
    include: ['src/test/unit/**/*.test.{ts,mts}'],
  },
});
