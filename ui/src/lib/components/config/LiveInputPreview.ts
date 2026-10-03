import type { LiveInputPreview, LiveInputType } from '../../../../../rendering/src/resources/LiveInputTextureManager';

/** Paint existing capture data without creating or owning device resources. */
export function drawLiveInputPreview(ctx: CanvasRenderingContext2D, type: LiveInputType, input: LiveInputPreview | null): boolean {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!input) {
    return false;
  }
  if (type === 'webcam') {
    const video = input.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return false;
    }
    try {
      ctx.drawImage(video, 0, 0, width, height);
      return true;
    } catch {
      // Capture may end between reading the source and painting a frame.
      return false;
    }
  }
  const { frequency, waveform } = input;
  if (!frequency?.length || !waveform?.length) {
    return false;
  }
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#638cff';
  const bars = 32;
  const barWidth = width / bars;
  for (let i = 0; i < bars; i++) {
    const value = frequency[Math.floor(i * frequency.length / bars)] / 255;
    ctx.fillRect(i * barWidth, height * (1 - value), Math.max(1, barWidth - 1), height * value);
  }
  ctx.strokeStyle = '#6ee7ad';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const y = height * (1 - waveform[Math.floor(x * waveform.length / width)] / 255);
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  return true;
}
