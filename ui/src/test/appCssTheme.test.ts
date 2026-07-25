import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

const channelControlThemeProperties = [
  '--vscode-foreground',
  '--vscode-descriptionForeground',
  '--vscode-input-background',
  '--vscode-input-foreground',
  '--vscode-input-border',
  '--vscode-focusBorder',
  '--vscode-badge-background',
];

function getThemeBlock(theme: 'light' | 'dark'): string {
  const match = appCss.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*{([^}]*)}`));
  expect(match, `Missing ${theme} browser theme`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('standalone browser theme', () => {
  it.each(['light', 'dark'] as const)(
    'defines channel media control properties for the %s theme',
    (theme) => {
      const themeBlock = getThemeBlock(theme);

      for (const property of channelControlThemeProperties) {
        expect(themeBlock, `${theme} theme is missing ${property}`).toMatch(
          new RegExp(`${property}\\s*:`),
        );
      }
    },
  );
});
