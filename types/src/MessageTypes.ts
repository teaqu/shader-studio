// Message types for communication between extension and UI

export interface BaseMessage {
  type: string;
}

export interface LogMessage extends BaseMessage {
  type: "log";
  payload: string[];
}

export interface DebugMessage extends BaseMessage {
  type: "debug";
  payload: string[];
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  payload: string[];
}

export interface WarningMessage extends BaseMessage {
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
  };
}

export interface ShaderSourceMessage extends BaseMessage {
  type: "shaderSource";
  code: string;
  config: any;
  path: string;
  buffers: Record<string, string>;
  forceCleanup?: boolean;
  pathMap?: Record<string, string>;
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

export type MessageEvent = LogMessage | DebugMessage | ErrorMessage | WarningMessage | RefreshMessage | GenerateConfigMessage | ShowConfigMessage | ShaderSourceMessage | CursorPositionMessage | UpdateConfigMessage | DebugModeStateMessage | UpdateShaderSourceMessage | ToggleEditorOverlayMessage;
