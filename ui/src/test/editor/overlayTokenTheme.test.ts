import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OVERLAY_TOKEN_SCOPE_CLASS,
  releaseOverlayTokenColors,
  resetOverlayTokenColors,
  retainOverlayTokenColors,
  syncOverlayTokenColors,
} from '../../lib/editor/overlayTokenTheme';

const STYLE_ELEMENT_ID = 'shader-studio-overlay-token-colors';

function addMonacoColors(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.className = 'monaco-colors';
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

function scopedCss(): string | null {
  return document.getElementById(STYLE_ELEMENT_ID)?.textContent ?? null;
}

describe('overlayTokenTheme', () => {
  beforeEach(() => {
    resetOverlayTokenColors();
    document.head.querySelectorAll('style.monaco-colors').forEach((style) => style.remove());
  });

  it('translates the light workspace palette into overlay colours', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }\n.mtk3 { color: #287d28; }');

    retainOverlayTokenColors('light');

    expect(scopedCss()).toBe([
      `.${OVERLAY_TOKEN_SCOPE_CLASS} .mtk2 { color: #ff70ff; }`,
      `.${OVERLAY_TOKEN_SCOPE_CLASS} .mtk3 { color: #4dbf4d; }`,
    ].join('\n'));
  });

  it('writes no overrides for a dark workspace, which already paints the overlay palette', () => {
    addMonacoColors('.mtk2 { color: #ff70ff; }');

    retainOverlayTokenColors('dark');

    expect(scopedCss()).toBe('');
  });

  it('reads every stylesheet Monaco has registered', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }');
    addMonacoColors('.mtk5 { color: #287d28; }');

    retainOverlayTokenColors('light');

    expect(scopedCss()).toContain(`.${OVERLAY_TOKEN_SCOPE_CLASS} .mtk2 { color: #ff70ff; }`);
    expect(scopedCss()).toContain(`.${OVERLAY_TOKEN_SCOPE_CLASS} .mtk5 { color: #4dbf4d; }`);
  });

  it('repaints the overrides when the workspace theme changes', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }');
    retainOverlayTokenColors('light');

    syncOverlayTokenColors('dark');
    expect(scopedCss()).toBe('');

    syncOverlayTokenColors('light');
    expect(scopedCss()).toBe(`.${OVERLAY_TOKEN_SCOPE_CLASS} .mtk2 { color: #ff70ff; }`);
  });

  it('reuses one style element across repeated syncs', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }');
    retainOverlayTokenColors('light');
    syncOverlayTokenColors('light');

    expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
  });

  it('does nothing while no overlay editor is open', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }');

    expect(syncOverlayTokenColors('light')).toBe('');
    expect(scopedCss()).toBeNull();
  });

  it('keeps the overrides while another overlay editor is still open', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }');
    retainOverlayTokenColors('light');
    retainOverlayTokenColors('light');

    releaseOverlayTokenColors();
    expect(scopedCss()).not.toBeNull();

    releaseOverlayTokenColors();
    expect(scopedCss()).toBeNull();
  });

  it('ignores extra releases from an already-closed overlay', () => {
    addMonacoColors('.mtk2 { color: #9b1bae; }');
    retainOverlayTokenColors('light');
    releaseOverlayTokenColors();
    releaseOverlayTokenColors();

    retainOverlayTokenColors('light');
    expect(scopedCss()).toBe(`.${OVERLAY_TOKEN_SCOPE_CLASS} .mtk2 { color: #ff70ff; }`);
  });

  it('produces no overrides before Monaco has generated its token colours', () => {
    retainOverlayTokenColors('light');

    expect(scopedCss()).toBe('');
  });

  describe('when Monaco stops emitting token colour rules', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('warns when the stylesheet is present but carries no .mtkN rules', () => {
      // A Monaco upgrade that changes the generated stylesheet would otherwise
      // leave the overlay on the light palette with no diagnostic at all.
      addMonacoColors('.monaco-editor { color: red; }');

      retainOverlayTokenColors('light');

      expect(scopedCss()).toBe('');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no .mtkN colour rules'));
    });

    it('warns once, not on every workspace theme switch', () => {
      addMonacoColors('.monaco-editor { color: red; }');

      retainOverlayTokenColors('light');
      syncOverlayTokenColors('dark');
      syncOverlayTokenColors('light');

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stays quiet before Monaco has added its stylesheet', () => {
      retainOverlayTokenColors('light');

      expect(warn).not.toHaveBeenCalled();
    });

    it('stays quiet when the rules are present', () => {
      addMonacoColors('.mtk2 { color: #9b1bae; }');

      retainOverlayTokenColors('light');

      expect(warn).not.toHaveBeenCalled();
    });

    it('stays quiet on a dark workspace, which needs no overrides', () => {
      addMonacoColors('.monaco-editor { color: red; }');

      retainOverlayTokenColors('dark');

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
