import type { ShaderConfig, SlangSourceModule } from '@shader-studio/types';
import type { CompileMode } from '../stores/compileModeStore';
import type { ShaderExplorerHostApi, Transport } from '../transport/MessageTransport';

/**
 * Viewer internals published for host-contributed panels.
 *
 * A shell such as `@shader-studio/web-host` decides which panels its layout
 * has and renders them itself; the viewer only publishes the state those
 * panels need, so it never has to know what the shell chose to build.
 */
export interface EditorPanelContext {
  ready: boolean;
  shaderCode: string;
  shaderPath: string;
  transport: Transport | null;
  config: ShaderConfig | null;
  customUniformInfo: { name: string; type: string }[];
  slangModules: SlangSourceModule[];
  compileMode: CompileMode;
  bufferNames: string[];
  activeBufferName: string;
  errors: string[];
  vimMode: boolean;
  onCodeChange: (code: string) => void;
  onBufferSwitch: (bufferName: string) => void;
  onCursorChange: (line: number, lineContent: string, bufferName: string) => void;
  onToggleVimMode: () => void;
}

export interface ExplorerPanelContext {
  ready: boolean;
  hostApi: ShaderExplorerHostApi | undefined;
  selectedShaderPath: string;
}

const noop = () => {};

let editorContext = $state<EditorPanelContext>({
  ready: false,
  shaderCode: '',
  shaderPath: '',
  transport: null,
  config: null,
  customUniformInfo: [],
  slangModules: [],
  compileMode: 'hot',
  bufferNames: [],
  activeBufferName: '',
  errors: [],
  vimMode: false,
  onCodeChange: noop,
  onBufferSwitch: noop,
  onCursorChange: noop,
  onToggleVimMode: noop,
});

let explorerContext = $state<ExplorerPanelContext>({
  ready: false,
  hostApi: undefined,
  selectedShaderPath: '',
});

export function setEditorPanelContext(context: EditorPanelContext): void {
  editorContext = context;
}

export function getEditorPanelContext(): EditorPanelContext {
  return editorContext;
}

export function setExplorerPanelContext(context: ExplorerPanelContext): void {
  explorerContext = context;
}

export function getExplorerPanelContext(): ExplorerPanelContext {
  return explorerContext;
}
