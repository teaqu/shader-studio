import type { ShaderConfig, SlangSourceModule } from '@shader-studio/types';
import type { CompileMode } from '../stores/compileModeStore';
import type { Transport } from '../transport/MessageTransport';

/** Read-only session snapshot published by the active viewer for an embedded editor.
 * Commands delegate directly to the viewer that owns editing and compilation.
 * The application supports one active viewer session per window.
 */
export interface ViewerSession {
  ready: boolean;
  shaderCode: string;
  shaderPath: string;
  selectedShaderPath: string;
  transport: Transport | null;
  config: ShaderConfig | null;
  customUniformInfo: { name: string; type: string }[];
  slangModules: SlangSourceModule[];
  compileMode: CompileMode;
  bufferNames: string[];
  activeBufferName: string;
  errors: string[];
  onCodeChange: (code: string) => void;
  onBufferSwitch: (bufferName: string) => void;
  onCursorChange: (line: number, lineContent: string, bufferName: string) => void;
}

let session = $state<ViewerSession | null>(null);

export function getViewerSession(): ViewerSession | null {
  return session;
}

export function setViewerSession(value: ViewerSession | null): void {
  session = value;
}
