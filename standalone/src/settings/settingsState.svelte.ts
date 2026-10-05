import { DEFAULT_SETTINGS, type StandaloneSettings, type StandaloneSettingsValues } from './StandaloneSettings';

let values = $state<StandaloneSettingsValues>({ ...DEFAULT_SETTINGS });

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
  };
}
