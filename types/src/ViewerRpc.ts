import type { StorageBufferSnapshot } from './StorageInspection';

export type ViewerUniformValue = number | number[] | boolean;

/** Live Image-pass context, not a readback of the last GPU frame. */
export interface ViewerInputs {
  scope: 'live-preview';
  pass: 'Image';
  builtins: Record<string, number | number[]>;
  unavailable: string[];
  script: { path: string | null };
  customUniforms: {
    name: string;
    type: string;
    value: ViewerUniformValue;
    /** Frozen custom values while paused; null while running. */
    pausedValue: ViewerUniformValue | null;
    lastWriter: 'script' | 'mcp' | 'unknown';
    scriptMayOverwrite: boolean;
    /** The script API does not declare defaults or ranges. */
    defaultValue: null;
    range: null;
  }[];
}

/** Host-independent requests carried by the existing viewer transports. */
export type ViewerAutomationOperation = 'select_shader' | 'inject_input'
  | 'start_input_recording' | 'stop_input_recording' | 'get_input_recording'
  | 'replay_inputs' | 'get_input_replay' | 'cancel_input_replay' | 'read_feedback'
  | 'start_recording' | 'stop_recording' | 'get_recording' | 'read_recording_chunk'
  | 'start_frame_capture' | 'get_frame_capture' | 'cancel_frame_capture';

export interface ViewerRpcRequest {
  type: 'viewerRpcRequest';
  requestId: string;
  operation: 'get_state' | 'capture' | 'settings' | 'playback' | 'read_storage' | 'cancel' | ViewerAutomationOperation;
  payload: Record<string, unknown>;
}

export interface ViewerRpcResponse {
  type: 'viewerRpcResponse';
  requestId: string;
  result?: ViewerSnapshot | ViewerCapture;
  error?: string;
}

export interface ViewerSnapshot {
  path: string;
  language: string;
  compileSequence: number | null;
  renderedSequence: number | null;
  compiling: boolean;
  errors: string[];
  warnings: string[];
  time: number;
  frame: number;
  paused: boolean;
  width: number;
  height: number;
  fpsLimit: number;
  speed: number;
  uniforms: { name: string; type: string; value: number | number[] | boolean }[];
  inputs?: ViewerInputs;
  automation?: Record<string, unknown>;
  resources?: {
    passes: { name: string; kind: string; path: string }[];
    storage: Record<string, { count: number; elementType: string }>;
  };
  storageRead?: Omit<StorageBufferSnapshot, 'data'> & {
    bytes: number[];
  };
}

export interface ViewerCapture extends ViewerSnapshot {
  mimeType: 'image/png';
  data: string;
}
