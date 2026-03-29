// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { resolveConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('ui vite config', () => {
  test('prefers the TypeScript config and keeps a relative asset base', async () => {
    const uiRoot = path.resolve(__dirname, '../../..');
    const legacyConfigPath = path.join(uiRoot, 'vite.config.js');

    await expect(fs.access(legacyConfigPath)).rejects.toThrow();

    const config = await resolveConfig(
      {
        root: uiRoot,
        logLevel: 'silent',
      },
      'build',
      'production',
    );

    expect(config.configFile).toBe(path.join(uiRoot, 'vite.config.ts'));
    expect(config.base).toBe('./');
  });
});
