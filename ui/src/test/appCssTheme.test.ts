import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceCssPath = resolve(process.cwd(), 'ui/src/app.css');
const appCssPath = existsSync(workspaceCssPath)
  ? workspaceCssPath
  : resolve(process.cwd(), 'src/app.css');
const appCss = readFileSync(appCssPath, 'utf8');

const channelControlThemeProperties = [
  '--vscode-foreground',
  '--vscode-descriptionForeground',
  '--vscode-input-background',
  '--vscode-input-foreground',
  '--vscode-input-border',
  '--vscode-focusBorder',
  '--vscode-badge-background',
];

const warningThemeProperties = [
  '--shader-studio-warning-foreground',
  '--shader-studio-warning-background',
  '--shader-studio-warning-border',
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

  it('uses orange rather than the yellow editor warning token for pause warnings', () => {
    expect(appCss).toMatch(
      /\.menu-bar button\.warning\s*{[^}]*background-color:\s*var\(--shader-studio-warning-background\);/s,
    );
    expect(appCss).toMatch(
      /\.error-tooltip\.warning\s*{[^}]*border-color:\s*var\(--shader-studio-warning-border\);/s,
    );
    expect(appCss).toMatch(
      /\.error-tooltip\.warning\s*{[^}]*background-color:\s*var\(--shader-studio-warning-background\);/s,
    );

    for (const theme of ['light', 'dark'] as const) {
      const themeBlock = getThemeBlock(theme);
      for (const property of warningThemeProperties) {
        expect(themeBlock, `${theme} theme is missing ${property}`).toMatch(
          new RegExp(`${property}\\s*:`),
        );
      }
    }

    expect(getThemeBlock('light')).toMatch(/--shader-studio-warning-foreground:\s*#c24100;/);
    expect(getThemeBlock('dark')).toMatch(/--shader-studio-warning-foreground:\s*#ff7a00;/);
  });
});
