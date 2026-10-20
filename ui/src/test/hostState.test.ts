import { afterEach, describe, expect, it } from 'vitest';
import { getHostEditorMobileNavigation, toggleHostEditorMobileNavigation, editorDescriptionsEnabled, getHostEditorDescriptions, toggleHostEditorDescriptions, getHostEditorWordWrap, toggleHostEditorWordWrap, getHostEditorAutoSuggestions, toggleHostEditorAutoSuggestions, getHostEditorMobileShaderBackdrop, toggleHostEditorMobileShaderBackdrop, getHostEditorOverlayOpacity, setHostEditorOverlayOpacity, configureHost, getHostCapabilities, getHostDefaultAssets, getHostTransportFactory, isHostPreviewEditorEnabled, resetHost } from '../lib/state/hostState.svelte';

afterEach(resetHost);

describe('viewer host contract', () => {
  it('only exposes mobile navigation for a host with writable preferences', () => {
    expect(getHostEditorMobileNavigation()).toBeUndefined();
    expect(() => toggleHostEditorMobileNavigation()).not.toThrow();
    configureHost({ setEditorMobileNavigation: () => { throw new Error('No preferences'); } });
    expect(getHostEditorMobileNavigation()).toBeUndefined();
    expect(() => toggleHostEditorMobileNavigation()).not.toThrow();
    let mobileNavigation: boolean | undefined;
    configureHost({
      getEditorPreferences: () => ({ fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on', mobileNavigation }),
      setEditorMobileNavigation: enabled => { mobileNavigation = enabled; },
    });
    expect(getHostEditorMobileNavigation()).toBe(true);
    toggleHostEditorMobileNavigation();
    expect(getHostEditorMobileNavigation()).toBe(false);
    toggleHostEditorMobileNavigation();
    expect(getHostEditorMobileNavigation()).toBe(true);
  });

  it('defaults the mobile shader backdrop off and only toggles it through a writable host preference', () => {
    expect(getHostEditorMobileShaderBackdrop()).toBeUndefined();
    expect(() => toggleHostEditorMobileShaderBackdrop()).not.toThrow();
    configureHost({ setEditorMobileShaderBackdrop: () => { throw new Error('No preference to toggle'); } });
    expect(getHostEditorMobileShaderBackdrop()).toBeUndefined();
    let mobileShaderBackdrop: boolean | undefined;
    configureHost({
      getEditorPreferences: () => ({ fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on', mobileShaderBackdrop }),
      setEditorMobileShaderBackdrop: enabled => { mobileShaderBackdrop = enabled; },
    });
    expect(getHostEditorMobileShaderBackdrop()).toBe(false);
    toggleHostEditorMobileShaderBackdrop();
    expect(getHostEditorMobileShaderBackdrop()).toBe(true);
    toggleHostEditorMobileShaderBackdrop();
    expect(getHostEditorMobileShaderBackdrop()).toBe(false);
  });

  it('keeps the preview editor enabled unless the host disables it for mobile', () => {
    expect(isHostPreviewEditorEnabled()).toBe(true);
    configureHost({ getPreviewEditorEnabled: () => false });
    expect(isHostPreviewEditorEnabled()).toBe(false);
    configureHost({ getPreviewEditorEnabled: () => true });
    expect(isHostPreviewEditorEnabled()).toBe(true);
  });
  it('defaults overlay shading to 75% and only writes rounded, clamped finite values', () => {
    expect(getHostEditorOverlayOpacity()).toBeUndefined();
    expect(() => setHostEditorOverlayOpacity(42)).not.toThrow();
    configureHost({ setEditorOverlayOpacity: () => { throw new Error('No preference to save'); } });
    expect(getHostEditorOverlayOpacity()).toBeUndefined();
    let overlayOpacity: number | undefined;
    const appliedValues: number[] = [];
    const setOverlayOpacity = (value: number) => {
      overlayOpacity = value;
      appliedValues.push(value);
    };
    configureHost({
      getEditorPreferences: () => ({ fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on', overlayOpacity }),
      setEditorOverlayOpacity: setOverlayOpacity,
    });
    expect(getHostEditorOverlayOpacity()).toBe(75);
    setHostEditorOverlayOpacity(42.4);
    expect(overlayOpacity).toBe(42);
    setHostEditorOverlayOpacity(-2);
    expect(overlayOpacity).toBe(0);
    setHostEditorOverlayOpacity(101);
    expect(overlayOpacity).toBe(100);
    setHostEditorOverlayOpacity(Number.NaN);
    expect(overlayOpacity).toBe(100);
    expect(appliedValues).toEqual([42, 0, 100]);
  });
  it('resolves separate description defaults and only toggles writable host preferences', () => {
    expect(editorDescriptionsEnabled(undefined, true)).toBe(false);
    expect(editorDescriptionsEnabled(undefined, false)).toBe(true);
    expect(getHostEditorDescriptions(true)).toBeUndefined();
    expect(() => toggleHostEditorDescriptions(true)).not.toThrow();
    const preferences = { fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off' as const, minimap: false, lineNumbers: 'on' as const, mobileDescriptions: false, desktopDescriptions: true };
    configureHost({ getEditorPreferences: () => preferences });
    expect(getHostEditorDescriptions(true)).toBeUndefined();
    configureHost({
      getEditorPreferences: () => preferences,
      setEditorDescriptions: (mobile, enabled) => {
        preferences[mobile ? 'mobileDescriptions' : 'desktopDescriptions'] = enabled;
      },
    });
    expect(getHostEditorDescriptions(true)).toBe(false);
    toggleHostEditorDescriptions(true);
    expect(getHostEditorDescriptions(true)).toBe(true);
    toggleHostEditorDescriptions(false);
    expect(getHostEditorDescriptions(false)).toBe(false);
    expect(getHostEditorDescriptions(true)).toBe(true);
  });
  it('only exposes automatic suggestions when the host can save that preference', () => {
    expect(getHostEditorAutoSuggestions()).toBeUndefined();
    expect(() => toggleHostEditorAutoSuggestions()).not.toThrow();
    configureHost({ setEditorAutoSuggestions: () => {
      throw new Error('No preference to toggle');
    } });
    expect(getHostEditorAutoSuggestions()).toBeUndefined();
    expect(() => toggleHostEditorAutoSuggestions()).not.toThrow();
    let autoSuggestions: boolean | undefined;
    configureHost({
      getEditorPreferences: () => ({ fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on', autoSuggestions }),
      setEditorAutoSuggestions: enabled => {
        autoSuggestions = enabled;
      },
    });
    expect(getHostEditorAutoSuggestions()).toBe(true);
    toggleHostEditorAutoSuggestions();
    expect(getHostEditorAutoSuggestions()).toBe(false);
    toggleHostEditorAutoSuggestions();
    expect(getHostEditorAutoSuggestions()).toBe(true);
  });
  it('defaults to no host services and to full extension capabilities', () => {
    expect(getHostDefaultAssets()).toEqual([]);
    expect(getHostTransportFactory()).toBeUndefined();
    expect(getHostCapabilities()).toEqual({ compileOnSave: true });
  });

  it('does not expose a word-wrap shortcut without a writable preference', () => {
    expect(getHostEditorWordWrap()).toBeUndefined();
    expect(() => toggleHostEditorWordWrap()).not.toThrow();
    configureHost({ setEditorWordWrap: () => {
      throw new Error('No preference to toggle');
    } });
    expect(getHostEditorWordWrap()).toBeUndefined();
    expect(() => toggleHostEditorWordWrap()).not.toThrow();
  });

  it('lets a shell that saves every edit drop compile-on-save', () => {
    configureHost({ capabilities: { compileOnSave: false } });
    expect(getHostCapabilities().compileOnSave).toBe(false);
    resetHost();
    expect(getHostCapabilities().compileOnSave).toBe(true);
  });

  it('exposes shell-provided services and resets to defaults', () => {
    const createTransport = () => ({}) as never;
    const assets = [{
      name: 'nebula.png', workspacePath: '/nebula.png', thumbnailUri: 'blob:nebula', isSameDirectory: false,
    }];
    configureHost({ createTransport, defaultAssets: assets });
    expect(getHostTransportFactory()).toBe(createTransport);
    expect(getHostDefaultAssets()).toEqual(assets);
    resetHost();
    expect(getHostTransportFactory()).toBeUndefined();
    expect(getHostDefaultAssets()).toEqual([]);
  });
});
