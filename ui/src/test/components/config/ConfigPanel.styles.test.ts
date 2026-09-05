import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspacePath = resolve(process.cwd(), 'ui/src/app.css');
const stylesheet = readFileSync(existsSync(workspacePath) ? workspacePath : resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('config add dropdown web theme colours', () => {
  it.each(['light', 'dark'])('defines opaque dropdown colours in the %s theme', (theme) => {
    const block = stylesheet.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1];
    expect(block).toBeDefined();
    for (const token of ['background', 'foreground', 'border']) {
      expect(block).toMatch(new RegExp(`--vscode-dropdown-${token}:\\s*#[0-9a-f]{6};`, 'i'));
    }
  });
});
