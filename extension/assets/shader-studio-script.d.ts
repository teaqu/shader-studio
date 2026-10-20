interface UniformContext {
  /** Current shader time in seconds */
  iTime: number;
  /** Time since last frame in seconds */
  iTimeDelta: number;
  /** Current frame rate */
  iFrameRate: number;
  /** Current frame number */
  iFrame: number;
  /** [width, height, aspect] */
  iResolution: [number, number, number];
  /** [x, y, click_x, click_y] */
  iMouse: [number, number, number, number];
  /** [year, month, day, seconds_since_midnight] */
  iDate: [number, number, number, number];
  /** Per-channel playback time (4 floats) */
  iChannelTime: [number, number, number, number];
  /** Audio sample rate (default 44100) */
  iSampleRate: number;
}

type UniformValue =
  | TypedUniform<number | number[]>
  | number
  | boolean
  | [number, number]
  | [number, number, number]
  | [number, number, number, number];

interface TypedUniform<T extends number | number[]> {
  readonly scriptUniformType: string;
  readonly value: T;
}
interface ScriptStreamOptions {
  /** 1–65536 uint32 words per rendered frame; default 4096. */
  maxPerFrame?: number;
  /** Queue capacity in words; default max(65536, maxPerFrame). Full pushes are rejected atomically. */
  maxQueued?: number;
}
interface ScriptStream {
  readonly queued: number;
  /** Copies uint32 words. Returns false when full or disposed; invalid words throw. */
  push(data: ArrayLike<number>): boolean;
}
interface StreamContext {
  stream(options?: ScriptStreamOptions): ScriptStream;
  /** Runs on reload, disposal, or failed initialization. */
  onDispose(cleanup: () => void): void;
}
interface UniformContext {
  int(value: number): TypedUniform<number>;
  uint(value: number): TypedUniform<number>;
  floatArray(values: readonly number[]): TypedUniform<number[]>;
  intArray(values: readonly number[]): TypedUniform<number[]>;
  uintArray(values: readonly number[]): TypedUniform<number[]>;
}
