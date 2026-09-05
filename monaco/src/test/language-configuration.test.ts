import { describe, it, expect } from 'vitest';
import { shaderLanguageConfiguration } from '../language-configuration';

const { indentationRules, onEnterRules } = shaderLanguageConfiguration;
const increase = indentationRules!.increaseIndentPattern;
const decrease = indentationRules!.decreaseIndentPattern;

describe('shaderLanguageConfiguration indentation rules', () => {
  it.each([
    'void main() {',
    '  if (x > 0.0) {',
    'for (int i = 0; i < 4; i++) {',
    'struct Material {',
    'vec3 c = mix(',
    'float k[] = [',
    '} else {',
  ])('increases indent after %j', (line) => {
    expect(increase.test(line)).toBe(true);
  });

  it.each([
    'void main() {}',
    'vec3 c = vec3(1.0);',
    '  return col;',
    '// open brace in a comment {',
    '}',
  ])('does not increase indent after %j', (line) => {
    expect(increase.test(line)).toBe(false);
  });

  it.each(['}', '  }', '};', ')', '  ]', '} else {'])(
    'decreases indent on %j',
    (line) => {
      expect(decrease.test(line)).toBe(true);
    },
  );

  it.each(['return col;', 'void main() {', '  vec3 c;'])(
    'does not decrease indent on %j',
    (line) => {
      expect(decrease.test(line)).toBe(false);
    },
  );

  it('treats a line that both closes and opens as an outdent-then-indent', () => {
    expect(increase.test('} else {')).toBe(true);
    expect(decrease.test('} else {')).toBe(true);
  });
});

describe('shaderLanguageConfiguration brackets and pairs', () => {
  it('declares the C-style bracket pairs monaco needs to auto-indent', () => {
    expect(shaderLanguageConfiguration.brackets).toEqual([
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ]);
  });

  it('auto-closes and surrounds every bracket pair', () => {
    const autoClosing = shaderLanguageConfiguration.autoClosingPairs!.map(
      (pair) => ('open' in pair ? pair.open : pair),
    );
    const surrounding = shaderLanguageConfiguration.surroundingPairs!.map(
      (pair) => ('open' in pair ? pair.open : pair),
    );

    for (const open of ['{', '[', '(', '"', "'"]) {
      expect(autoClosing).toContain(open);
      expect(surrounding).toContain(open);
    }
    expect(autoClosing).toContain('/*');
  });

  it('uses C-style comment tokens so comment toggling works', () => {
    expect(shaderLanguageConfiguration.comments).toEqual({
      lineComment: '//',
      blockComment: ['/*', '*/'],
    });
  });
});

describe('shaderLanguageConfiguration onEnterRules', () => {
  const matching = (before: string, after = '') =>
    onEnterRules!.filter(
      (rule) =>
        (!rule.beforeText || rule.beforeText.test(before))
        && (!rule.afterText || rule.afterText.test(after)),
    );

  it('splits a doc comment open across the closing marker', () => {
    const [rule] = matching('/**', '*/');
    // IndentAction.IndentOutdent
    expect(rule.action.indentAction).toBe(2);
    expect(rule.action.appendText).toBe(' * ');
  });

  it('continues a doc comment with a star prefix', () => {
    const [rule] = matching('/** first line');
    expect(rule.action.appendText).toBe(' * ');
    // IndentAction.None — the closing marker is not on the next line yet.
    expect(rule.action.indentAction).toBe(0);
  });

  it('continues an already-starred comment line', () => {
    const [rule] = matching(' * middle line');
    expect(rule.action.appendText).toBe('* ');
    // IndentAction.None
    expect(rule.action.indentAction).toBe(0);
  });

  it('removes the extra space once the comment is closed', () => {
    const [rule] = matching(' */');
    expect(rule.action.removeText).toBe(1);
    expect(rule.action.indentAction).toBe(0);
  });

  it('leaves ordinary code lines alone', () => {
    expect(matching('vec3 c = vec3(1.0);')).toHaveLength(0);
  });
});
