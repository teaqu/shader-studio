import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { name: 'extension-mcp', environment: 'node', include: ['test/mcp/**/*.test.ts'], maxWorkers: 4 },
  resolve: { alias: { vscode: path.resolve(__dirname, 'test/mcp/vscode.ts') } },
});
