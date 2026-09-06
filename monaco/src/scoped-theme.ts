import {
  shaderStudioTransparentLightTheme,
  shaderStudioTransparentTheme,
} from './glsl-theme';

/**
 * Monaco resolves token colours through a single, page-wide theme: every
 * editor in a document shares one `.mtkN { color }` rule set. The shader
 * preview overlay and the docked editor pane are alive at the same time in
 * standalone, so the overlay cannot own the global theme without repainting
 * the pane's tokens.
 *
 * These helpers give the overlay its own palette instead: the global theme
 * stays with the workspace theme, and the overlay's container gets scoped
 * rules that re-map each generated `.mtkN` class to the colour the overlay's
 * theme would have used for the same token scope.
 */

export interface ThemeTokenRule {
  token: string;
  foreground?: string;
}

/** Rules Monaco's built-in `vs` theme supplies to inheriting light themes. */
const VS_LIGHT_RULES: ThemeTokenRule[] = [
  { token: '', foreground: '000000' },
  { token: 'invalid', foreground: 'cd3131' },
  { token: 'variable', foreground: '001188' },
  { token: 'variable.predefined', foreground: '4864AA' },
  { token: 'constant', foreground: 'dd0000' },
  { token: 'comment', foreground: '008000' },
  { token: 'number', foreground: '098658' },
  { token: 'number.hex', foreground: '3030c0' },
  { token: 'regexp', foreground: '800000' },
  { token: 'annotation', foreground: '808080' },
  { token: 'type', foreground: '008080' },
  { token: 'delimiter', foreground: '000000' },
  { token: 'delimiter.html', foreground: '383838' },
  { token: 'delimiter.xml', foreground: '0000FF' },
  { token: 'tag', foreground: '800000' },
  { token: 'metatag', foreground: 'e00000' },
  { token: 'metatag.content.html', foreground: 'FF0000' },
  { token: 'metatag.html', foreground: '808080' },
  { token: 'metatag.xml', foreground: '808080' },
  { token: 'key', foreground: '863B00' },
  { token: 'string.key.json', foreground: 'A31515' },
  { token: 'string.value.json', foreground: '0451A5' },
  { token: 'attribute.name', foreground: 'FF0000' },
  { token: 'attribute.value', foreground: '0451A5' },
  { token: 'string', foreground: 'A31515' },
  { token: 'string.sql', foreground: 'FF0000' },
  { token: 'keyword', foreground: '0000FF' },
  { token: 'keyword.json', foreground: '0451A5' },
  { token: 'keyword.flow', foreground: 'AF00DB' },
  { token: 'operator.sql', foreground: '778899' },
];

/** The `vs-dark` counterparts of {@link VS_LIGHT_RULES}, paired by scope. */
const VS_DARK_RULES: ThemeTokenRule[] = [
  { token: '', foreground: 'D4D4D4' },
  { token: 'invalid', foreground: 'f44747' },
  { token: 'variable', foreground: '74B0DF' },
  { token: 'variable.predefined', foreground: '4864AA' },
  { token: 'constant', foreground: '569CD6' },
  { token: 'comment', foreground: '608B4E' },
  { token: 'number', foreground: 'B5CEA8' },
  { token: 'number.hex', foreground: '5BB498' },
  { token: 'regexp', foreground: 'B46695' },
  { token: 'annotation', foreground: 'cc6666' },
  { token: 'type', foreground: '3DC9B0' },
  { token: 'delimiter', foreground: 'DCDCDC' },
  { token: 'delimiter.html', foreground: '808080' },
  { token: 'delimiter.xml', foreground: '808080' },
  { token: 'tag', foreground: '569CD6' },
  { token: 'metatag', foreground: 'DD6A6F' },
  { token: 'metatag.content.html', foreground: '9CDCFE' },
  { token: 'metatag.html', foreground: '569CD6' },
  { token: 'metatag.xml', foreground: '569CD6' },
  { token: 'key', foreground: '9CDCFE' },
  { token: 'string.key.json', foreground: '9CDCFE' },
  { token: 'string.value.json', foreground: 'CE9178' },
  { token: 'attribute.name', foreground: '9CDCFE' },
  { token: 'attribute.value', foreground: 'CE9178' },
  { token: 'string', foreground: 'CE9178' },
  { token: 'string.sql', foreground: 'FF0000' },
  { token: 'keyword', foreground: '569CD6' },
  { token: 'keyword.json', foreground: 'CE9178' },
  { token: 'keyword.flow', foreground: 'C586C0' },
  { token: 'operator.sql', foreground: '778899' },
];

/** Monaco emits colours as `#rrggbb`; compare them case-insensitively. */
export function normalizeColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function relativeLuminance(color: string): number {
  const hex = normalizeColor(color).slice(1);
  if (hex.length < 6) {
    return 0;
  }
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function scopeColors(rules: ThemeTokenRule[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const rule of rules) {
    if (rule.foreground) {
      colors.set(rule.token, normalizeColor(rule.foreground));
    }
  }
  return colors;
}

/**
 * Scopes the editor's own languages emit, most significant first.
 *
 * A source colour keys the translation, not a scope, so two scopes sharing one
 * light colour collide and only one dark twin can win. Monaco's `vs` palette
 * has several such pairs, and without a priority the winner is whichever rule
 * the base tables happen to list last: `regexp` and `tag` are both `#800000`
 * in `vs`, so TypeScript regex literals took the markup scope's blue instead
 * of the mauve `vs-dark` gives `regexp`.
 *
 * The overlay only ever hosts GLSL, Slang, TypeScript and JavaScript, so a
 * colour shared with an HTML, XML, JSON or SQL scope belongs to the language
 * scope. Ties between two scopes in this list are genuinely ambiguous and are
 * reported by {@link findTokenColorConflicts}.
 */
export const EDITOR_TOKEN_SCOPES: readonly string[] = [
  '',
  'identifier',
  'keyword',
  'keyword.flow',
  'keyword.preprocessor',
  'keyword.preprocessor.language',
  'type',
  'string',
  'comment',
  'number',
  'number.float',
  'number.hex',
  'regexp',
  'operator',
  'delimiter',
  'variable',
  'variable.predefined',
  'support.function',
  'constant',
  'annotation',
  'invalid',
];

export interface TokenColorTranslationOptions {
  /**
   * Scopes that outrank the rest when they share a source colour, most
   * significant first. Scopes absent from the list rank below every entry in
   * it, and ties fall back to source order so later theme rules still win.
   */
  priorityScopes?: readonly string[];
}

/** One source colour that two scopes translate to different target colours. */
export interface TokenColorConflict {
  /** The shared source colour, normalized. */
  color: string;
  /** Scopes that carry {@link color} in the source theme, in source order. */
  scopes: string[];
  /** The distinct target colours those scopes ask for. */
  targets: string[];
  /** The target colour the translation actually resolves {@link color} to. */
  resolved: string;
}

interface TranslationCandidate {
  token: string;
  target: string;
  rank: number;
  order: number;
}

function candidatesByColor(
  from: ThemeTokenRule[],
  to: ThemeTokenRule[],
  priorityScopes: readonly string[],
): Map<string, TranslationCandidate[]> {
  const target = scopeColors(to);
  const byColor = new Map<string, TranslationCandidate[]>();
  from.forEach((rule, order) => {
    if (!rule.foreground) {
      return;
    }
    const mapped = target.get(rule.token);
    if (!mapped) {
      return;
    }
    const priority = priorityScopes.indexOf(rule.token);
    const color = normalizeColor(rule.foreground);
    const candidates = byColor.get(color) ?? [];
    candidates.push({
      token: rule.token,
      target: mapped,
      rank: priority === -1 ? priorityScopes.length : priority,
      order,
    });
    byColor.set(color, candidates);
  });
  return byColor;
}

/** The candidate that owns a colour: best rank, then latest source rule. */
function winner(candidates: TranslationCandidate[]): TranslationCandidate {
  return candidates.reduce((best, candidate) => {
    if (candidate.rank !== best.rank) {
      return candidate.rank < best.rank ? candidate : best;
    }
    return candidate.order > best.order ? candidate : best;
  });
}

/**
 * Pair two themes' rules by token scope, yielding a source-colour to
 * target-colour lookup. Where one source colour serves several scopes, the
 * highest-priority scope wins; among equals, later rules win, so theme
 * overrides take precedence over the inherited base rules they are
 * concatenated after.
 */
export function createTokenColorTranslation(
  from: ThemeTokenRule[],
  to: ThemeTokenRule[],
  options: TokenColorTranslationOptions = {},
): Map<string, string> {
  const byColor = candidatesByColor(from, to, options.priorityScopes ?? []);
  const translation = new Map<string, string>();
  for (const [color, candidates] of byColor) {
    translation.set(color, winner(candidates).target);
  }
  return translation;
}

/**
 * Source colours whose scopes disagree about the target colour even after
 * {@link TokenColorTranslationOptions.priorityScopes} has been applied, so
 * the resolution is arbitrary. A theme edit that introduces a new one is a
 * silently wrong overlay colour; the suite asserts the known set.
 */
export function findTokenColorConflicts(
  from: ThemeTokenRule[],
  to: ThemeTokenRule[],
  options: TokenColorTranslationOptions = {},
): TokenColorConflict[] {
  const byColor = candidatesByColor(from, to, options.priorityScopes ?? []);
  const conflicts: TokenColorConflict[] = [];
  for (const [color, candidates] of byColor) {
    const best = winner(candidates);
    const rivals = candidates.filter(
      (candidate) => candidate.rank === best.rank && candidate.target !== best.target,
    );
    if (rivals.length > 0) {
      conflicts.push({
        color,
        scopes: candidates.map((candidate) => candidate.token),
        targets: [...new Set(candidates.map((candidate) => candidate.target))],
        resolved: best.target,
      });
    }
  }
  return conflicts;
}

const LIGHT_THEME_RULES = [...VS_LIGHT_RULES, ...shaderStudioTransparentLightTheme.rules];
const DARK_THEME_RULES = [...VS_DARK_RULES, ...shaderStudioTransparentTheme.rules];
const OVERLAY_TRANSLATION_OPTIONS: TokenColorTranslationOptions = {
  priorityScopes: EDITOR_TOKEN_SCOPES,
};

/** Colours of the light workspace theme mapped to their dark overlay twins. */
export const LIGHT_TO_DARK_TOKEN_COLORS = createTokenColorTranslation(
  LIGHT_THEME_RULES,
  DARK_THEME_RULES,
  OVERLAY_TRANSLATION_OPTIONS,
);

/** Conflicts left in {@link LIGHT_TO_DARK_TOKEN_COLORS}, for the suite to pin. */
export const LIGHT_TO_DARK_TOKEN_CONFLICTS = findTokenColorConflicts(
  LIGHT_THEME_RULES,
  DARK_THEME_RULES,
  OVERLAY_TRANSLATION_OPTIONS,
);

export interface ScopedTokenCssOptions {
  /** Selector the overrides are nested under, e.g. `.shader-studio-overlay`. */
  selector: string;
  /** Source colour to target colour lookup, keyed by normalized `#rrggbb`. */
  translation: Map<string, string>;
  /** Colour for unmapped tokens that would be illegible on the target. */
  fallbackColor: string;
  /**
   * Unmapped colours are kept when their relative luminance is at least this
   * value, so third-party palettes keep their hue where they stay readable.
   */
  minRelativeLuminance: number;
}

const TOKEN_RULE_PATTERN = /\.mtk(\d+)\s*\{\s*color:\s*([^;}]+)[;\s]*\}/g;

/**
 * How many distinct `.mtkN` colour rules Monaco's stylesheet exposes.
 *
 * {@link buildScopedTokenCss} returning nothing is ambiguous: every colour may
 * already match the target, or the scrape may have found no rules at all
 * because a Monaco upgrade changed how the stylesheet is emitted. Callers that
 * need to tell those apart count the rules first.
 */
export function countTokenColorRules(colorsCss: string): number {
  return new Set(
    [...colorsCss.matchAll(TOKEN_RULE_PATTERN)].map((match) => match[1]),
  ).size;
}

/**
 * Translate Monaco's generated `.mtkN` colour rules into scoped overrides.
 *
 * @param colorsCss - Contents of Monaco's `style.monaco-colors` element.
 */
export function buildScopedTokenCss(colorsCss: string, options: ScopedTokenCssOptions): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const match of colorsCss.matchAll(TOKEN_RULE_PATTERN)) {
    const index = match[1];
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    const source = normalizeColor(match[2]);
    const mapped = options.translation.get(source)
      ?? (relativeLuminance(source) >= options.minRelativeLuminance ? null : options.fallbackColor);
    if (mapped && mapped !== source) {
      rules.push(`${options.selector} .mtk${index} { color: ${mapped}; }`);
    }
  }
  return rules.join('\n');
}
