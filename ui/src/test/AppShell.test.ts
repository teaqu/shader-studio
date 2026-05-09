import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('app shell', () => {
  it('uses the colored Shader Studio icon as the web favicon', () => {
    const baseDir = resolve(import.meta.dirname, '../..');
    const indexHtml = readFileSync(resolve(baseDir, 'index.html'), 'utf8');
    const iconPath = resolve(baseDir, 'public/shader-studio-icon.svg');

    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/shader-studio-icon.svg" />');
    expect(existsSync(iconPath)).toBe(true);
  });
});
