import type { Transport } from "../transport/MessageTransport";
import type { ShaderConfig, SlangSourceModule } from "@shader-studio/types";
import type { Snippet } from "svelte";
type CompileMode = "hot" | "save" | "manual";

export interface ShaderEditorProps {
  isVisible?: boolean;
  shaderCode?: string;
  shaderPath?: string;
  transport: Transport;
  onCodeChange?: (code: string, path?: string) => void;
  vimMode?: boolean;
  topInset?: number;
  bottomInset?: number;
  bufferNames?: string[];
  activeBufferName?: string;
  onBufferSwitch?: (bufferName: string) => void;
  errors?: string[];
  compileMode?: CompileMode;
  onManualCompile?: () => void;
  config?: ShaderConfig | null;
  customUniformInfo?: { name: string; type: string }[];
  slangModules?: SlangSourceModule[];
  commonPath?: string;
  commonSource?: string;
  sourcePassNames?: string[];
  onCursorChange?: (line: number, lineContent: string, bufferName: string) => void;
  displayMode?: "overlay" | "pane";
  /** Portal for editor completion/hover widgets when an ancestor clips or transforms them. */
  overflowWidgetsDomNode?: HTMLElement;
  /** Host-owned controls rendered in the editor's bottom toolbar. */
  editorOptions?: Snippet;
}
