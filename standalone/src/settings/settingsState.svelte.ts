import { DEFAULT_SETTINGS, type StandaloneSettings, type StandaloneSettingsValues } from './StandaloneSettings';

let values = $state<StandaloneSettingsValues>({ ...DEFAULT_SETTINGS });

export function getInterfaceTheme() {
  return values['theme.style'];
}

export function getMobileModeEnabled(): boolean {
  return values['layout.mobileMode'];
}

export function getDefaultShaderMode() {
  return values['webgpu.defaultRenderAuthoring'];
}

export function connectSettings(settings: StandaloneSettings): () => void {
  values = { ...settings.snapshot };
  return settings.subscribe((snapshot) => {
    values = { ...snapshot };
  });
}

export function getEditorPreferences() {
  return {
    fontSize: values['editor.fontSize'], tabSize: values['editor.tabSize'],
    insertSpaces: values['editor.insertSpaces'], wordWrap: values['editor.wordWrap'],
    minimap: values['editor.minimap.enabled'], lineNumbers: values['editor.lineNumbers'],
    desktopEditor: values['editor.desktop'], mobileEditor: values['editor.mobile'],
    autoSuggestions: values['editor.autoSuggestions'],
    desktopDescriptions: values['editor.desktopDescriptions'],
    mobileDescriptions: values['editor.mobileDescriptions'],
    mobileNavigation: values['editor.mobileNavigation'],
    mobileShaderBackdrop: values['editor.mobileShaderBackdrop'],
    overlayOpacity: values['editor.overlayOpacity'],
  };
}
