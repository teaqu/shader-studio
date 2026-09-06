import { describe, expect, it } from 'vitest';

import {
  EDITOR_TOKEN_SCOPES,
  LIGHT_TO_DARK_TOKEN_COLORS,
  LIGHT_TO_DARK_TOKEN_CONFLICTS,
  buildScopedTokenCss,
  createTokenColorTranslation,
  findTokenColorConflicts,
  normalizeColor,
} from '../scoped-theme';
import {
  shaderStudioTransparentLightTheme,
  shaderStudioTransparentTheme,
} from '../glsl-theme';

const overlayOptions = {
  selector: '.overlay',
  translation: LIGHT_TO_DARK_TOKEN_COLORS,
  fallbackColor: '#d4d4d4',
  minRelativeLuminance: 0.25,
};

describe('normalizeColor', () => {
  it('lowercases and prefixes bare hex values', () => {
    expect(normalizeColor('CC99FF')).toBe('#cc99ff');
    expect(normalizeColor(' #Cc99Ff ')).toBe('#cc99ff');
  });
});

describe('createTokenColorTranslation', () => {
  it('pairs colours by token scope', () => {
    const translation = createTokenColorTranslation(
      [{ token: 'keyword', foreground: '0000FF' }],
      [{ token: 'keyword', foreground: '569CD6' }],
    );
    expect(translation.get('#0000ff')).toBe('#569cd6');
  });

  it('ignores scopes the target theme does not style', () => {
    const translation = createTokenColorTranslation(
      [{ token: 'keyword', foreground: '0000FF' }, { token: 'tag', foreground: '800000' }],
      [{ token: 'keyword', foreground: '569CD6' }],
    );
    expect(translation.has('#800000')).toBe(false);
  });

  it('skips rules without a foreground on either side', () => {
    const translation = createTokenColorTranslation(
      [{ token: 'strong' }, { token: 'keyword', foreground: '0000FF' }],
      [{ token: 'strong', foreground: 'FFFFFF' }, { token: 'keyword' }],
    );
    expect(translation.size).toBe(0);
  });

  it('lets later rules override earlier ones for the same scope', () => {
    const translation = createTokenColorTranslation(
      [{ token: 'type', foreground: '008080' }, { token: 'type', foreground: '6336A8' }],
      [{ token: 'type', foreground: '3DC9B0' }, { token: 'type', foreground: 'CC99FF' }],
    );
    expect(translation.get('#008080')).toBe('#cc99ff');
    expect(translation.get('#6336a8')).toBe('#cc99ff');
  });
});

describe('LIGHT_TO_DARK_TOKEN_COLORS', () => {
  it('maps every Shader Studio light token colour to a dark twin of a scope that uses it', () => {
    for (const rule of shaderStudioTransparentLightTheme.rules) {
      const sharing = shaderStudioTransparentLightTheme.rules
        .filter((candidate) => normalizeColor(candidate.foreground) === normalizeColor(rule.foreground));
      const darkTwins = sharing.map((candidate) => {
        const dark = shaderStudioTransparentTheme.rules.find((entry) => entry.token === candidate.token);
        expect(dark, `no dark rule for ${candidate.token}`).toBeDefined();
        return normalizeColor(dark!.foreground);
      });
      expect(darkTwins).toContain(LIGHT_TO_DARK_TOKEN_COLORS.get(normalizeColor(rule.foreground)));
    }
  });

  it('maps the inherited vs defaults, including plain text and json values', () => {
    // #000000 is vs's plain text and delimiter colour; both dark twins are the
    // same near-white, so either resolution stays readable on the overlay.
    expect(['#d4d4d4', '#f8f8f8']).toContain(LIGHT_TO_DARK_TOKEN_COLORS.get('#000000'));
    expect(LIGHT_TO_DARK_TOKEN_COLORS.get('#0451a5')).toBe('#ce9178');
  });
});

describe('priority scopes', () => {
  const shared = [
    { token: 'regexp', foreground: '800000' },
    { token: 'tag', foreground: '800000' },
  ];
  const targets = [
    { token: 'regexp', foreground: 'B46695' },
    { token: 'tag', foreground: '569CD6' },
  ];

  it('gives a shared colour to the higher-priority scope, not the last rule', () => {
    const translation = createTokenColorTranslation(shared, targets, {
      priorityScopes: ['regexp'],
    });

    expect(translation.get('#800000')).toBe('#b46695');
  });

  it('ranks by list order, so an earlier scope beats a later one', () => {
    const from = [{ token: 'delimiter', foreground: '1F1F1F' }, { token: 'identifier', foreground: '1F1F1F' }];
    const to = [{ token: 'delimiter', foreground: 'F8F8F8' }, { token: 'identifier', foreground: 'FFFFFF' }];

    expect(createTokenColorTranslation(from, to, { priorityScopes: ['identifier', 'delimiter'] })
      .get('#1f1f1f')).toBe('#ffffff');
    expect(createTokenColorTranslation(from, to, { priorityScopes: ['delimiter', 'identifier'] })
      .get('#1f1f1f')).toBe('#f8f8f8');
  });

  it('falls back to source order between scopes of equal rank', () => {
    // Neither scope is listed, so both rank last and the later rule wins.
    expect(createTokenColorTranslation(shared, targets, { priorityScopes: ['keyword'] })
      .get('#800000')).toBe('#569cd6');
    expect(createTokenColorTranslation(shared, targets).get('#800000')).toBe('#569cd6');
  });

  it('still lets a later rule override an earlier one for the same scope', () => {
    const translation = createTokenColorTranslation(
      [{ token: 'type', foreground: '008080' }, { token: 'type', foreground: '6336A8' }],
      [{ token: 'type', foreground: '3DC9B0' }, { token: 'type', foreground: 'CC99FF' }],
      { priorityScopes: EDITOR_TOKEN_SCOPES },
    );

    expect(translation.get('#008080')).toBe('#cc99ff');
    expect(translation.get('#6336a8')).toBe('#cc99ff');
  });
});

describe('findTokenColorConflicts', () => {
  it('reports a colour two equally ranked scopes disagree about', () => {
    const conflicts = findTokenColorConflicts(
      [{ token: 'operator', foreground: '1F1F1F' }, { token: 'identifier', foreground: '1F1F1F' }],
      [{ token: 'operator', foreground: 'F8F8F8' }, { token: 'identifier', foreground: 'FFFFFF' }],
    );

    expect(conflicts).toEqual([{
      color: '#1f1f1f',
      scopes: ['operator', 'identifier'],
      targets: ['#f8f8f8', '#ffffff'],
      resolved: '#ffffff',
    }]);
  });

  it('does not report a collision a priority scope resolves', () => {
    expect(findTokenColorConflicts(
      [{ token: 'regexp', foreground: '800000' }, { token: 'tag', foreground: '800000' }],
      [{ token: 'regexp', foreground: 'B46695' }, { token: 'tag', foreground: '569CD6' }],
      { priorityScopes: ['regexp'] },
    )).toEqual([]);
  });

  it('does not report scopes that agree on the target colour', () => {
    expect(findTokenColorConflicts(
      [{ token: 'number', foreground: 'A64A00' }, { token: 'number.hex', foreground: 'A64A00' }],
      [{ token: 'number', foreground: 'FFB866' }, { token: 'number.hex', foreground: 'FFB866' }],
    )).toEqual([]);
  });
});

describe('LIGHT_TO_DARK_TOKEN_CONFLICTS', () => {
  // Pinned so a theme edit that makes two editor scopes share a light colour
  // fails here instead of silently repainting the overlay's tokens.
  it('leaves only the markup colour genuinely ambiguous', () => {
    expect(LIGHT_TO_DARK_TOKEN_CONFLICTS).toEqual([
      {
        // Markup and SQL scopes the editor's languages never emit; whichever
        // dark colour wins, no token in a shader or TypeScript file uses it.
        color: '#ff0000',
        scopes: ['metatag.content.html', 'attribute.name', 'string.sql'],
        targets: ['#9cdcfe', '#ff0000'],
        resolved: '#ff0000',
      },
    ]);
  });

  it('resolves the light theme\'s shared #1f1f1f by scope priority', () => {
    // Light paints operators, delimiters and identifiers the same #1f1f1f
    // while dark splits them, so only one dark colour can win. identifier
    // outranks the other two in EDITOR_TOKEN_SCOPES, and all three dark
    // colours are near-white, so operators keep reading correctly.
    expect(LIGHT_TO_DARK_TOKEN_COLORS.get('#1f1f1f')).toBe('#ffffff');
    expect(EDITOR_TOKEN_SCOPES.indexOf('identifier'))
      .toBeLessThan(EDITOR_TOKEN_SCOPES.indexOf('operator'));
  });

  it('resolves the vs collisions in favour of the scopes the editor emits', () => {
    // regexp/tag, annotation/metatag and default/delimiter all collide in vs.
    expect(LIGHT_TO_DARK_TOKEN_COLORS.get('#800000')).toBe('#b46695');
    expect(LIGHT_TO_DARK_TOKEN_COLORS.get('#808080')).toBe('#cc6666');
    expect(LIGHT_TO_DARK_TOKEN_COLORS.get('#000000')).toBe('#d4d4d4');
  });
});

describe('buildScopedTokenCss', () => {
  it('scopes translated colours under the selector', () => {
    const css = buildScopedTokenCss('.mtk1 { color: #1f1f1f; }\n.mtk2 { color: #9b1bae; }', overlayOptions);
    // #1f1f1f is shared by the light theme's operator, delimiter and
    // identifier scopes; the last scope wins.
    expect(css).toContain('.overlay .mtk1 { color: #ffffff; }');
    expect(css).toContain('.overlay .mtk2 { color: #ff70ff; }');
  });

  it('ignores the non-colour rules Monaco emits alongside token colours', () => {
    const css = buildScopedTokenCss('.mtki { font-style: italic; }\n.mtkb { font-weight: bold; }', overlayOptions);
    expect(css).toBe('');
  });

  it('emits nothing when the translated colour matches the source', () => {
    const css = buildScopedTokenCss('.mtk3 { color: #ff70ff; }', {
      ...overlayOptions,
      translation: new Map([['#ff70ff', '#ff70ff']]),
    });
    expect(css).toBe('');
  });

  it('keeps unmapped colours that stay readable on the overlay', () => {
    const css = buildScopedTokenCss('.mtk4 { color: #ffcc00; }', overlayOptions);
    expect(css).toBe('');
  });

  it('falls back for unmapped colours too dark to read on the overlay', () => {
    const css = buildScopedTokenCss('.mtk5 { color: #101020; }', overlayOptions);
    expect(css).toBe('.overlay .mtk5 { color: #d4d4d4; }');
  });

  it('keeps the first rule when Monaco repeats an index', () => {
    const css = buildScopedTokenCss('.mtk2 { color: #9b1bae; }\n.mtk2 { color: #101020; }', overlayOptions);
    expect(css).toBe('.overlay .mtk2 { color: #ff70ff; }');
  });

  it('tolerates spacing and uppercase in Monaco\'s generated rules', () => {
    const css = buildScopedTokenCss('.mtk7{color:#9B1BAE}', overlayOptions);
    expect(css).toBe('.overlay .mtk7 { color: #ff70ff; }');
  });

  it('returns an empty string for stylesheet text without token rules', () => {
    expect(buildScopedTokenCss('', overlayOptions)).toBe('');
    expect(buildScopedTokenCss('.monaco-editor { color: red; }', overlayOptions)).toBe('');
  });
});
