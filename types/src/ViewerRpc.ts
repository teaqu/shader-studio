/** Host-independent requests carried by the existing viewer transports. */
export interface ViewerRpcRequest {
  type: 'viewerRpcRequest';
  requestId: string;
  operation: 'get_state' | 'capture' | 'settings' | 'playback' | 'read_storage' | 'cancel';
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
  resources?: {
    passes: { name: string; kind: string; path: string }[];
    storage: Record<string, { count: number; elementType: string }>;
  };
  storageRead?: {
    name: string; elementType: string; stride: number; start: number; count: number;
    bytes: number[];
  };
}

export interface ViewerCapture extends ViewerSnapshot {
  mimeType: 'image/png';
  data: string;
}
