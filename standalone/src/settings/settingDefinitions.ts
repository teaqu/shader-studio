import type { StandaloneSettingKey } from './StandaloneSettings';

interface SettingDefinition {
  key: StandaloneSettingKey;
  label: string;
  description: string;
  group: 'Preview' | 'Language services' | 'Editor';
  kind: 'boolean' | 'number' | 'choice';
  choices?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
}
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: 'webgpu.defaultRenderAuthoring', label: 'Default shader mode', description: 'Default for new WGSL/Slang shaders, buffers, and source insertion. Choose Built-in hooks or Native entry points.', group: 'Preview', kind: 'choice', choices: [{ value: 'hooks', label: 'Built-in' }, { value: 'native', label: 'Native' }] },
  { key: 'webgpu.useViewerCamera', label: 'Use viewer camera', description: 'Apply the viewer camera to mesh shaders by default. Individual shaders and passes can override this.', group: 'Preview', kind: 'boolean' },
  { key: 'navigateOnBufferSwitch', label: 'Open editor on buffer switch', description: 'Select the corresponding file when switching buffers in the preview.', group: 'Preview', kind: 'boolean' },
  ...(['glsl', 'slang', 'wgsl'] as const).map((language): SettingDefinition => ({ key: `languageServers.${language}.enabled`, label: `${language === 'slang' ? 'Slang' : language.toUpperCase()} language service`, description: 'Enable diagnostics, completion, hover, and navigation for this language.', group: 'Language services', kind: 'boolean' })),
  { key: 'editor.colorDecorators', label: 'Color swatches', description: 'Show color previews and pickers in shader source.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.fontSize', label: 'Font size', description: 'Editor font size in pixels.', group: 'Editor', kind: 'number', min: 8, max: 40 },
  { key: 'editor.tabSize', label: 'Tab size', description: 'Number of columns per indentation level.', group: 'Editor', kind: 'number', min: 1, max: 8 },
  { key: 'editor.insertSpaces', label: 'Insert spaces', description: 'Use spaces instead of tab characters when indenting.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.wordWrap', label: 'Word wrap', description: 'Wrap long lines to the editor width.', group: 'Editor', kind: 'choice' },
  { key: 'editor.minimap.enabled', label: 'Minimap', description: 'Show the source overview alongside the editor.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.lineNumbers', label: 'Line numbers', description: 'Show line numbers beside shader source.', group: 'Editor', kind: 'choice' },
];
