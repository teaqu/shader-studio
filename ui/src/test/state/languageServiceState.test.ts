import { beforeEach, describe, expect, it } from "vitest";
import {
  getLanguageServiceSettings,
  resetLanguageServiceSettings,
  setLanguageServiceSettings,
} from "../../lib/state/languageServiceState.svelte";

describe("languageServiceState", () => {
  beforeEach(() => resetLanguageServiceSettings());

  it("enables both browser services and color decorators by default", () => {
    expect(getLanguageServiceSettings()).toEqual({
      glslEnabled: true,
      slangEnabled: true,
      colorDecorators: true,
    });
  });

  it("updates languages independently without discarding other settings", () => {
    setLanguageServiceSettings({ glslEnabled: false });
    expect(getLanguageServiceSettings()).toEqual({
      glslEnabled: false,
      slangEnabled: true,
      colorDecorators: true,
    });
  });
});
