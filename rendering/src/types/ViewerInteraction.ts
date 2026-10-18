export type ViewerInputEvent =
  | { type: 'pointer_move' | 'pointer_down'; x: number; y: number }
  | { type: 'pointer_up'; x?: number; y?: number }
  | { type: 'key_down' | 'key_up'; code: string }
  | { type: 'release_all' };

/** Shader-facing input state after a batch has been applied to one preview. */
export interface ViewerInputState {
  mouse: [number, number, number, number];
  heldCodes: string[];
}
export type ViewerInputSource = 'physical' | 'injected';
export type ViewerInputListener = (event: ViewerInputEvent, source: ViewerInputSource) => void;

export interface FeedbackReadback {
  pass: string;
  phase: 'front/latest';
  origin: 'bottom-left';
  width: number;
  height: number;
  components: 4;
  sourceFormat: 'rgba32float' | 'rgba16float';
  values: (number | 'NaN' | 'Infinity' | '-Infinity')[];
}
