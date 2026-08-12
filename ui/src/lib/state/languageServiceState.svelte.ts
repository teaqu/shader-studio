export interface LanguageServiceSettings {
  glslEnabled: boolean;
  slangEnabled: boolean;
  colorDecorators: boolean;
  trace: "off" | "messages" | "verbose";
}

const DEFAULT_SETTINGS: LanguageServiceSettings = {
  glslEnabled: true,
  slangEnabled: true,
  colorDecorators: true,
  trace: "off",
};

let settings = $state<LanguageServiceSettings>({ ...DEFAULT_SETTINGS });

export function getLanguageServiceSettings(): LanguageServiceSettings { return settings; }
export function setLanguageServiceSettings(value: Partial<LanguageServiceSettings>): void { settings = { ...settings, ...value }; }
export function resetLanguageServiceSettings(): void { settings = { ...DEFAULT_SETTINGS }; }
