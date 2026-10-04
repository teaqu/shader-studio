/** Shadertoy's analyser defaults; the 512-wide texture exposes its lower FFT bins. */
export function createAudioAnalyser(context: Pick<AudioContext, "createAnalyser">): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  analyser.minDecibels = -100;
  analyser.maxDecibels = -30;
  return analyser;
}
