import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { editorTheme } from '../theme';

const views: EditorView[] = [];
afterEach(() => {
  while (views.length) {
    views.pop()?.destroy();
  }
  document.body.replaceChildren();
});

function mountTheme(dark: boolean, overlay: boolean, fontSize: number, overlayOpacity?: number, doc = 'fn main() {}'): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), editorTheme(dark, overlay, fontSize, overlayOpacity)],
    }),
  });
  views.push(view);
  return view;
}

function backgroundColors(element: HTMLElement): string[] {
  return Array.from(document.styleSheets).flatMap(sheet =>
    Array.from(sheet.cssRules)
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .filter(rule => element.matches(rule.selectorText))
      .map(rule => rule.style.getPropertyValue('background-color'))
      .filter(Boolean));
}

describe('editorTheme', () => {
  it.each([false, true])('keeps portalled diagnostic popups content-sized (dark: %s)', dark => {
    const view = mountTheme(dark, false, 14);
    // CodeMirror copies themeClasses to its external tooltip container.
    const portal = document.body.appendChild(document.createElement('div'));
    portal.className = view.themeClasses;
    const tooltip = portal.appendChild(document.createElement('div'));
    tooltip.className = 'cm-tooltip cm-tooltip-hover';
    const rules = Array.from(document.styleSheets).flatMap(sheet =>
      Array.from(sheet.cssRules).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule));
    const heights = (element: HTMLElement) => rules
      .filter(rule => element.matches(rule.selectorText))
      .map(rule => rule.style.getPropertyValue('height')).filter(Boolean);
    expect(heights(view.dom)).toContain('100%');
    expect(heights(portal)).not.toContain('100%');
    expect(heights(tooltip)).toContain('max-content');
    expect(rules.filter(rule => tooltip.matches(rule.selectorText))
      .some(rule => rule.style.getPropertyValue('overflow-y') === 'auto')).toBe(true);
  });

  it('installs a light theme with the configured font size', () => {
    const view = mountTheme(false, false, 17);
    expect(view.dom.className).toContain('cm-editor');
    expect(view.contentDOM.parentElement?.className).toContain('cm-scroller');
    expect(Array.from(document.styleSheets).some(sheet => Array.from(sheet.cssRules ?? []).some(rule => rule.cssText.includes('17px')))).toBe(true);
  });

  it('installs dark overlay styling with the overlay text treatment', () => {
    const view = mountTheme(true, true, 13);
    const css = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules ?? []).map(rule => rule.cssText)).join('\n');
    expect(css).toContain('13px');
    expect(css).toContain('text-shadow');
    expect(css).toContain('rgb(10 10 10 / 75%)');
  });

  it.each([
    [undefined, '75%'],
    [0, '0%'],
    [35, '35%'],
    [100, '100%'],
    [-1, '0%'],
    [101, '100%'],
    [Number.NaN, '75%'],
    [Number.POSITIVE_INFINITY, '75%'],
  ] as const)('shades overlay code rows at %s opacity', (opacity, expected) => {
    const view = mountTheme(true, true, 14, opacity, 'one\ntwo');
    const line = view.dom.querySelector<HTMLElement>('.cm-line');

    expect(line).not.toBeNull();
    expect(backgroundColors(line!)).toContain(`rgb(10 10 10 / ${expected})`);
  });

  it('keeps overlay active rows and line numbers shaded without tinting the gutter background', () => {
    const view = mountTheme(true, true, 14, 35, 'one\ntwo');
    view.focus();
    const line = view.dom.querySelector<HTMLElement>('.cm-line');
    const gutter = view.dom.querySelector<HTMLElement>('.cm-gutters');
    const gutterRow = view.dom.querySelector<HTMLElement>('.cm-gutterElement.cm-activeLineGutter');

    expect(line).not.toBeNull();
    expect(gutter).not.toBeNull();
    expect(gutterRow).not.toBeNull();

    expect(backgroundColors(line!)).toContain('rgb(10 10 10 / 35%)');
    expect(backgroundColors(line!)).not.toContain('rgb(255 255 255 / 6%)');
    expect(backgroundColors(gutterRow!)).toContain('rgb(10 10 10 / 35%)');
    expect(backgroundColors(gutterRow!)).not.toContain('rgb(255 255 255 / 6%)');
    expect(backgroundColors(gutter!)).toContain('transparent');
  });

  it('keeps pane active rows highlighted', () => {
    const view = mountTheme(true, false, 14);
    const line = view.dom.querySelector<HTMLElement>('.cm-line');
    line!.classList.add('cm-activeLine');

    expect(backgroundColors(line!)).toContain('rgb(255 255 255 / 6%)');
  });
});

// Safari focus zoom follows the editable element's rendered font size. Keep
// mobile editors readable while retaining each configured desktop font size.
describe('mobile editing font size', () => {
  function fontRules(element: HTMLElement) {
    const rules: { media: string | null; size: string }[] = [];
    function collect(list: CSSRuleList, media: string | null = null) {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSMediaRule) {
          collect(rule.cssRules, rule.conditionText);
        } else if (rule instanceof CSSStyleRule && element.matches(rule.selectorText) && rule.style.getPropertyValue('font-size')) {
          rules.push({ media, size: rule.style.getPropertyValue('font-size') });
        }
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      collect(sheet.cssRules);
    }
    return rules;
  }

  it.each([8, 14, 16, 22])('uses a mobile-safe minimum for a %ipx preference', fontSize => {
    const view = mountTheme(false, false, fontSize);
    expect(fontRules(view.dom).find(rule => rule.media === null)?.size).toBe(`${fontSize}px`);
    expect(fontRules(view.scrollDOM).find(rule => rule.media?.includes('pointer: coarse'))?.size).toBe(`${Math.max(16, fontSize)}px`);
    const panels = view.dom.appendChild(document.createElement('div'));
    panels.className = 'cm-panels';
    expect(fontRules(panels).find(rule => rule.media?.includes('pointer: coarse'))?.size).toBe(`${Math.max(16, fontSize)}px`);
  });

  it('applies the same minimum in the preview overlay', () => {
    const view = mountTheme(true, true, 12);
    expect(fontRules(view.scrollDOM).find(rule => rule.media?.includes('max-width: 767px'))?.size).toBe('16px');
  });
});
