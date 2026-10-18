import { defineProject } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineProject({
  test: { name: 'extension-mcp', environment: 'node', include: ['test/mcp/**/*.test.ts'] },
  resolve: { alias: { vscode: fileURLToPath(new URL('./test/mcp/vscode.ts', import.meta.url)) } },
});
