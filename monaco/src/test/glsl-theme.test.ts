import { describe, it, expect } from 'vitest';
import {
  shaderStudioTheme,
  shaderStudioTransparentLightTheme,
  shaderStudioTransparentTheme,
} from '../glsl-theme';

describe('shaderStudioTheme', () => {
  it('has base property set to vs-dark', () => {
    expect(shaderStudioTheme.base).toBe('vs-dark');
  });

  it('has colors property', () => {
    expect(shaderStudioTheme).toHaveProperty('colors');
  });

  it('has rules array with token definitions', () => {
    expect(Array.isArray(shaderStudioTheme.rules)).toBe(true);
    expect(shaderStudioTheme.rules.length).toBeGreaterThan(0);

    for (const rule of shaderStudioTheme.rules) {
      expect(rule).toHaveProperty('token');
      expect(rule).toHaveProperty('foreground');
    }
  });

  it('has inherit set to true', () => {
    expect(shaderStudioTheme.inherit).toBe(true);
  });
});

describe('shaderStudioTransparentTheme', () => {
  it('has base property set to vs-dark', () => {
    expect(shaderStudioTransparentTheme.base).toBe('vs-dark');
  });

  it('has colors property', () => {
    expect(shaderStudioTransparentTheme).toHaveProperty('colors');
  });

  it('has rules array', () => {
    expect(Array.isArray(shaderStudioTransparentTheme.rules)).toBe(true);
    expect(shaderStudioTransparentTheme.rules.length).toBeGreaterThan(0);
  });

  it('has transparent editor background', () => {
    expect(shaderStudioTransparentTheme.colors['editor.background']).toBe('#00000000');
  });

  it('has transparent gutter backgrounds', () => {
    expect(shaderStudioTransparentTheme.colors['editorGutter.background']).toBe('#00000000');
    expect(shaderStudioTransparentTheme.colors['editorGutter.modifiedBackground']).toBe('#00000000');
    expect(shaderStudioTransparentTheme.colors['editorGutter.addedBackground']).toBe('#00000000');
    expect(shaderStudioTransparentTheme.colors['editorGutter.deletedBackground']).toBe('#00000000');
  });

  it('has transparent error border', () => {
    expect(shaderStudioTransparentTheme.colors['editorError.border']).toBe('#00000000');
  });
});

describe('shaderStudioTransparentLightTheme', () => {
  it('uses Monaco\'s light base and a dark editor foreground', () => {
    expect(shaderStudioTransparentLightTheme.base).toBe('vs');
    expect(shaderStudioTransparentLightTheme.colors['editor.foreground']).toBe('#1f1f1f');
    expect(shaderStudioTransparentLightTheme.colors['editorCursor.foreground']).toBe('#1f1f1f');
  });
});

describe('portalled editor widgets', () => {
  it.each([
    ['dark', shaderStudioTransparentTheme, '#1e1e1e'],
    ['light', shaderStudioTransparentLightTheme, '#ffffff'],
  ] as const)('keeps %s diagnostic and completion sheets opaque', (_name, theme, background) => {
    const colors: Record<string, string> = theme.colors;
    expect(colors['editorHoverWidget.background']).toBe(background);
    expect(colors['editorSuggestWidget.background']).toBe(background);
  });
});
