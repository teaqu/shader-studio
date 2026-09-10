import { beforeEach, describe, expect, it } from "vitest";
import {
  getLanguageServiceSettings,
  resetLanguageServiceSettings,
  setLanguageServiceSettings,
} from "../../lib/state/languageServiceState.svelte";

describe("languageServiceState", () => {
  beforeEach(() => resetLanguageServiceSettings());

  it("enables all three browser services and color decorators by default", () => {
    expect(getLanguageServiceSettings()).toEqual({
      glslEnabled: true,
      slangEnabled: true,
      wgslEnabled: true,
      colorDecorators: true,
    });
  });

  it.each(['glslEnabled', 'slangEnabled', 'wgslEnabled'] as const)("updates %s independently and resets it", (setting) => {
    setLanguageServiceSettings({ [setting]: false, colorDecorators: false });
    expect(getLanguageServiceSettings()).toEqual({
      glslEnabled: true,
      slangEnabled: true,
      wgslEnabled: true,
      colorDecorators: false,
      [setting]: false,
    });

    setLanguageServiceSettings({ [setting]: true });
    expect(getLanguageServiceSettings()[setting]).toBe(true);
    expect(getLanguageServiceSettings().colorDecorators).toBe(false);

    resetLanguageServiceSettings();
    expect(getLanguageServiceSettings()).toEqual({
      glslEnabled: true,
      slangEnabled: true,
      wgslEnabled: true,
      colorDecorators: true,
    });
  });
});
