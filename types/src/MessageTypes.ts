// Message types for communication between extension and UI

import type { ProfileIndex, ProfileData } from './ProfileTypes';
import type { SlangDependencyDiagnostic, SlangSourceModule } from './SlangSourceModule';
import type { ShaderAuthoringEnvironment } from './shader-environment/ShaderAuthoringEnvironment';

export interface BaseMessage {
  type: string;
}

/**
 * Revision marker for compile reports. The host stamps every `shaderSource`
 * with a per-path sequence, and the client echoes it on the error, warning,
 * and log messages that compile produced. Reports are advisory strings with
 * no ordering otherwise, so without the echo a slow client's stale failure
 * can land after a fast client's success and stick until the next edit.
 * Reports without a sequence predate the marker and are always processed.
 */
export interface CompileReportMarker {
  /** Shader path the report's compile was triggered for. */
  shaderPath?: string;
  /** Per-path send sequence of the `shaderSource` the report answers. */
  compileSequence?: number;
}

export interface LogMessage extends BaseMessage, CompileReportMarker {
  type: "log";
  payload: string[];
}

export interface DebugMessage extends BaseMessage {
  type: "debug";
  payload: string[];
}

export interface ErrorMessage extends BaseMessage, CompileReportMarker {
  type: "error";
  payload: string[];
}

export interface WarningMessage extends BaseMessage, CompileReportMarker {
  type: "warning";
  payload: string[];
}

export interface RefreshMessage extends BaseMessage {
  type: "refresh";
  payload: {
    path?: string;
  };
}

export interface GenerateConfigMessage extends BaseMessage {
  type: "generateConfig";
  payload: {
    shaderPath?: string;
  };
}

export interface ShowConfigMessage extends BaseMessage {
  type: "showConfig";
  payload: {
    shaderPath?: string;
    sourcePath?: string;
  };
}

export interface ShaderSourceMessage extends BaseMessage {
  type: "shaderSource";
  code: string;
  config: any;
  path: string;
  buffers: Record<string, string>;
  /** Shader source language. Defaults to "glsl" when absent. */
  language?: "glsl" | "slang";
  reload?: boolean;
  pathMap?: Record<string, string>;
  bufferPathMap?: Record<string, string>;
  scriptBundleError?: string;
  /** The shader's config file could not be read; the host sends the source without it. */
  configError?: string;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  /**
   * A bare preview of a file that declares no `mainImage` - a common pass, a
   * helper. It carries no config, so it says nothing about the shader's script:
   * a client must not read the absent `customUniform*` fields as "this shader
   * has no script uniforms" and throw the ones it holds away.
   */
  scriptContextOmitted?: boolean;
  /** In-memory Slang modules, grouped by the pass that imports them. */
  slangModules?: SlangSourceModule[];
  /** Original unprocessed source before #include/import expansion — used by the debugger for accurate line mapping. */
  originalCode?: string;
  /** Dependency discovery failures produced by the extension host. */
  slangDependencyDiagnostics?: SlangDependencyDiagnostic[];
  /**
   * Per-path send sequence. The client echoes it on the compile's reports so
   * the host can drop reports a newer send already superseded. See
   * CompileReportMarker.
   */
  compileSequence?: number;
  cursorPosition?: {
    line: number;
    character: number;
    lineContent: string;
    filePath: string;
  };
}

export interface CursorPositionMessage extends BaseMessage {
  type: "cursorPosition";
  payload: {
    line: number;
    character: number;
    lineContent: string;
    filePath: string;
  };
}

export interface UpdateConfigMessage extends BaseMessage {
  type: "updateConfig";
  payload: {
    config: any;
    text: string;
  };
}

export interface DebugModeStateMessage extends BaseMessage {
  type: "debugModeState";
  payload: {
    enabled: boolean;
  };
}

export interface ShaderLockStateMessage extends BaseMessage {
  type: "shaderLockState";
  payload: {
    lockedShaderPath?: string;
  };
}

export interface UpdateShaderSourceMessage extends BaseMessage {
  type: "updateShaderSource";
  payload: {
    code: string;
    path: string;
  };
}

export interface ToggleEditorOverlayMessage extends BaseMessage {
  type: "toggleEditorOverlay";
}

export interface ResetLayoutMessage extends BaseMessage {
  type: "resetLayout";
}

export interface ManualCompileMessage extends BaseMessage {
  type: "manualCompile";
}

export interface SetCompileModeMessage extends BaseMessage {
  type: "setCompileMode";
  payload: {
    mode: "hot" | "save" | "manual";
  };
}

export interface NavigateToBufferMessage extends BaseMessage {
  type: "navigateToBuffer";
  payload: {
    bufferPath: string;
    shaderPath: string;
    mode?: "active" | "beside";
  };
}

export interface WorkspaceFileInfo {
  name: string;
  workspacePath: string;
  thumbnailUri: string;
  isSameDirectory: boolean;
}

export interface RequestWorkspaceFilesMessage extends BaseMessage {
  type: "requestWorkspaceFiles";
  payload: { extensions: string[]; shaderPath: string };
}

export interface WorkspaceFilesMessage extends BaseMessage {
  type: "workspaceFiles";
  payload: { files: WorkspaceFileInfo[] };
}

export interface ForkShaderMessage extends BaseMessage {
  type: "forkShader";
  payload: { shaderPath: string };
}

export interface CustomUniformValuesMessage extends BaseMessage {
  type: "customUniformValues";
  payload: {
    values: { name: string; type: string; value: number | number[] | boolean }[];
  };
}

/**
 * Asks the host to send every custom uniform value again, not just the ones
 * that changed. After its first batch the host sends deltas, so a client that
 * rebuilt its uniform state - a swapped engine, a compile that reinstalled the
 * declarations - would hold zero for every uniform the script never changes.
 */
export interface RequestCustomUniformValuesMessage extends BaseMessage {
  type: "requestCustomUniformValues";
}

/**
 * What the viewer is showing, so a uniform script running in the extension host
 * sees the shader's own time and inputs instead of inventing them from wall
 * clock - and stops running while the shader is paused.
 */
export interface ScriptRuntimeStateMessage extends BaseMessage {
  type: "scriptRuntimeState";
  payload: {
    paused: boolean;
    time: number;
    frame: number;
    frameRate: number;
    resolution: [number, number, number];
    mouse: [number, number, number, number];
    channelTimes: number[];
    sampleRate: number;
  };
}

export interface LanguageServiceSettingsMessage extends BaseMessage {
  type: "languageServiceSettings";
  payload: {
    glslEnabled: boolean;
    slangEnabled: boolean;
    colorDecorators: boolean;
    trace: "off" | "messages" | "verbose";
  };
}

export interface ShaderAuthoringEnvironmentMessage extends BaseMessage {
  type: "shaderAuthoringEnvironment";
  payload: ShaderAuthoringEnvironment;
}

export interface GoToLineMessage extends BaseMessage {
  type: "goToLine";
  payload: {
    line: number;
    filePath: string;
  };
}

export interface SaveFileMessage extends BaseMessage {
  type: "saveFile";
  payload: {
    data: string;
    defaultName: string;
    filters: Record<string, string[]>;
  };
}

export interface SaveFileResultMessage extends BaseMessage {
  type: "saveFileResult";
  payload: {
    success: boolean;
    path?: string;
    error?: string;
  };
}

export type FileDialogFileType =
  | 'script'
  | 'glsl'
  | 'glsl-buffer'
  | 'glsl-common'
  | 'glsl-vertex'
  | 'slang-buffer'
  | 'slang-common'
  | 'slang-compute'
  | 'slang-vertex'
  | 'model'
  | 'texture'
  | 'video'
  | 'audio'
  | 'cubemap';

export interface SelectFileMessage extends BaseMessage {
  type: 'selectFile';
  payload: {
    shaderPath: string;
    fileType: FileDialogFileType;
    requestId: string;
  };
}

export interface CreateFileMessage extends BaseMessage {
  type: 'createFile';
  payload: {
    shaderPath: string;
    suggestedPath: string;
    fileType: FileDialogFileType;
    requestId: string;
  };
}

export interface FileSelectedMessage extends BaseMessage {
  type: 'fileSelected';
  payload: {
    path: string;
    requestId: string;
  };
}

// Profile messages — UI → Extension (reads return responses with same requestId)
export interface ProfileReadIndexMessage extends BaseMessage {
  type: 'profile:readIndex';
  requestId: string;
}
export interface ProfileIndexDataMessage extends BaseMessage {
  type: 'profile:indexData';
  requestId: string;
  index: ProfileIndex | null;
}
export interface ProfileReadProfileMessage extends BaseMessage {
  type: 'profile:readProfile';
  requestId: string;
  id: string;
}
export interface ProfileDataMessage extends BaseMessage {
  type: 'profile:profileData';
  requestId: string;
  data: ProfileData | null;
}
export interface ProfileWriteProfileMessage extends BaseMessage {
  type: 'profile:writeProfile';
  id: string;
  data: ProfileData;
}
export interface ProfileWriteIndexMessage extends BaseMessage {
  type: 'profile:writeIndex';
  index: ProfileIndex;
}
export interface ProfileDeleteProfileMessage extends BaseMessage {
  type: 'profile:deleteProfile';
  id: string;
}

export type MessageEvent = LogMessage | DebugMessage | ErrorMessage | WarningMessage | RefreshMessage | GenerateConfigMessage | ShowConfigMessage | ShaderSourceMessage | CursorPositionMessage | UpdateConfigMessage | DebugModeStateMessage | ShaderLockStateMessage | UpdateShaderSourceMessage | ToggleEditorOverlayMessage | ResetLayoutMessage | ManualCompileMessage | SetCompileModeMessage | NavigateToBufferMessage | RequestWorkspaceFilesMessage | WorkspaceFilesMessage | ForkShaderMessage | GoToLineMessage | SaveFileMessage | SaveFileResultMessage | SelectFileMessage | CreateFileMessage | FileSelectedMessage | CustomUniformValuesMessage | RequestCustomUniformValuesMessage | ScriptRuntimeStateMessage | LanguageServiceSettingsMessage | ShaderAuthoringEnvironmentMessage | ProfileReadIndexMessage | ProfileIndexDataMessage | ProfileReadProfileMessage | ProfileDataMessage | ProfileWriteProfileMessage | ProfileWriteIndexMessage | ProfileDeleteProfileMessage;
