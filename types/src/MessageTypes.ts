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

export interface RefreshMessage extends BaseMessage {
  type: "refresh";
  payload: {
    path?: string;
  };
}

export interface ShaderSourceMessage extends BaseMessage {
  type: "shaderSource";
  code: string;
  config: any;
  path: string;
  buffers: Record<string, string>;
}

export type MessageEvent = LogMessage | DebugMessage | ErrorMessage | RefreshMessage | ShaderSourceMessage;
