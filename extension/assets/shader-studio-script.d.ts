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
  | number
  | boolean
  | [number, number]
  | [number, number, number]
  | [number, number, number, number];
