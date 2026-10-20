import type { StandaloneSettingKey } from './StandaloneSettings';

interface SettingDefinitionBase {
  key: StandaloneSettingKey;
  label: string;
  description: string;
  kind: 'boolean' | 'number' | 'choice';
  choices?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
}
type SettingDefinition = SettingDefinitionBase & (
  | { group: 'Theme'; kind: 'choice'; choices: readonly { value: string; label: string }[] }
  | { group: 'Preview' | 'Language services' | 'Editor' }
);
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: 'theme.style', label: 'Style', description: 'VS Code keeps the familiar studio controls. Pixel adds an arcade palette, crisp edges and raised buttons in both light and dark mode.', group: 'Theme', kind: 'choice', choices: [{ value: 'classic', label: 'VS Code' }, { value: 'pixel', label: 'Pixel' }] },
  { key: 'layout.mobileMode', label: 'Mobile mode', description: 'Use the mobile layout on narrow screens. Turn off to keep desktop docking and controls at every window size.', group: 'Preview', kind: 'boolean' },
  { key: 'webgpu.defaultRenderAuthoring', label: 'Default shader mode', description: 'Default for new WGSL/Slang shaders, buffers, and source insertion. Choose Built-in hooks or Native entry points.', group: 'Preview', kind: 'choice', choices: [{ value: 'hooks', label: 'Built-in' }, { value: 'native', label: 'Native' }] },
  { key: 'preview.preventMouseDefaults', label: 'Prevent default mouse actions', description: 'Prevent context menus, middle-click actions, back/forward navigation and page scrolling over the canvas. Shaders still receive mouse input when off.', group: 'Preview', kind: 'boolean' },
  { key: 'webgpu.useViewerCamera', label: 'Use viewer camera', description: 'Apply the viewer camera to mesh shaders by default. Individual shaders and passes can override this.', group: 'Preview', kind: 'boolean' },
  { key: 'navigateOnBufferSwitch', label: 'Open editor on buffer switch', description: 'Select the corresponding file when switching buffers in the preview.', group: 'Preview', kind: 'boolean' },
  ...(['glsl', 'slang', 'wgsl'] as const).map((language): SettingDefinition => ({ key: `languageServers.${language}.enabled`, label: `${language === 'slang' ? 'Slang' : language.toUpperCase()} language service`, description: 'Enable diagnostics, completion, hover, and navigation for this language.', group: 'Language services', kind: 'boolean' })),
  { key: 'editor.colorDecorators', label: 'Color swatches', description: 'Show color previews and pickers in Monaco source.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.desktop', label: 'Desktop editor', description: 'Choose the editor used on desktop screens.', group: 'Editor', kind: 'choice', choices: [{ value: 'monaco', label: 'Monaco' }, { value: 'codemirror', label: 'CodeMirror' }] },
  { key: 'editor.mobile', label: 'Mobile editor', description: 'Choose the editor used on narrow screens and touch-first devices.', group: 'Editor', kind: 'choice', choices: [{ value: 'monaco', label: 'Monaco' }, { value: 'codemirror', label: 'CodeMirror' }] },
  { key: 'editor.fontSize', label: 'Font size', description: 'Editor font size in pixels.', group: 'Editor', kind: 'number', min: 8, max: 40 },
  { key: 'editor.tabSize', label: 'Tab size', description: 'Number of columns per indentation level.', group: 'Editor', kind: 'number', min: 1, max: 8 },
  { key: 'editor.insertSpaces', label: 'Insert spaces', description: 'Use spaces instead of tab characters when indenting.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.wordWrap', label: 'Word wrap', description: 'Wrap long lines to the editor width.', group: 'Editor', kind: 'choice' },
  { key: 'editor.autoSuggestions', label: 'Automatic suggestions', description: 'Show code suggestions while typing. You can still request suggestions with Ctrl+Space when this is off.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.desktopDescriptions', label: 'Desktop descriptions', description: 'Show symbol descriptions when hovering over code on desktop.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.mobileDescriptions', label: 'Mobile descriptions', description: 'Show symbol descriptions when interacting with code on mobile. Off by default to keep the editor clear.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.mobileNavigation', label: 'Mobile Editor / Preview tabs', description: 'Show compact Editor and Preview buttons beside the keys while the mobile keyboard is open.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.minimap.enabled', label: 'Minimap', description: 'Show the source overview alongside the Monaco editor.', group: 'Editor', kind: 'boolean' },
  { key: 'editor.lineNumbers', label: 'Line numbers', description: 'Show line numbers beside shader source.', group: 'Editor', kind: 'choice' },
];
