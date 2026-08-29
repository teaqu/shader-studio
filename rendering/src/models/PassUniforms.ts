export interface PassUniforms {
  res: number[] | Float32Array;
  time: number;
  timeDelta: number;
  frameRate: number;
  mouse: number[] | Float32Array;
  frame: number;
  date: number[] | Float32Array;
  channelTime: number[];    // Per-channel playback time
  sampleRate: number;       // audio sample rate (default 44100)
  channelLoaded: number[];  // Per-channel loaded state (0 or 1)
  cameraPos: number[] | Float32Array;  // vec3 - camera position (WASD/QE)
  cameraDir: number[] | Float32Array;  // vec3 - camera direction (mouse/IJKL)
}
