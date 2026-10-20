import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';
import { shaderStudioAliases } from '../vite.aliases.mjs';

// Pure extension units run in Node; VS Code API integration remains in the
// existing extension-host suite. This project supplies Istanbul counters too.
export default defineProject({
  resolve: { alias: { '@shader-studio/utils': shaderStudioAliases['@shader-studio/utils'], vscode: fileURLToPath(new URL('./src/test/unit/vscodeStub.ts', import.meta.url)) } },
  test: {
    name: 'extension-units',
    environment: 'node',
    include: ['src/test/unit/**/*.test.{ts,mts}'],
  },
});
