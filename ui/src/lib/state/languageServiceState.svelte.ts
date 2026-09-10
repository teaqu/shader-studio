export interface LanguageServiceSettings {
  glslEnabled: boolean;
  slangEnabled: boolean;
  wgslEnabled: boolean;
  colorDecorators: boolean;
}

const DEFAULT_SETTINGS: LanguageServiceSettings = {
  glslEnabled: true,
  slangEnabled: true,
  wgslEnabled: true,
  colorDecorators: true,
};

let settings = $state<LanguageServiceSettings>({ ...DEFAULT_SETTINGS });

export function getLanguageServiceSettings(): LanguageServiceSettings {
  return settings; 
}
export function setLanguageServiceSettings(value: Partial<LanguageServiceSettings>): void {
  settings = { ...settings, ...value }; 
}
export function resetLanguageServiceSettings(): void {
  settings = { ...DEFAULT_SETTINGS }; 
}
