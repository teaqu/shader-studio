const cache = new Map<string, Float32Array>();
const pending = new Map<string, Promise<Float32Array | null>>();

export async function getWaveformPeaks(
  url: string,
  numPoints?: number,
): Promise<Float32Array | null> {
  const key = numPoints ? `${url}:${numPoints}` : url;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const inflight = pending.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = generatePeaks(url, numPoints);
  pending.set(key, promise);

  try {
    const result = await promise;
    if (result) {
      cache.set(key, result);
    }
    return result;
  } finally {
    pending.delete(key);
  }
}

async function generatePeaks(
  url: string,
  numPoints?: number,
): Promise<Float32Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioCtx = new OfflineAudioContext(1, 1, 44100);
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const duration = audioBuffer.duration;
    // If explicit count given, use it; otherwise auto-scale
    const barCount = numPoints ?? Math.min(Math.max(Math.round(duration * 4), 30), 200);

    const channelData = audioBuffer.getChannelData(0);
    const peaks = new Float32Array(barCount);
    const windowSize = Math.floor(channelData.length / barCount);

    let globalMax = 0;
    for (let i = 0; i < barCount; i++) {
      const start = i * windowSize;
      const end = Math.min(start + windowSize, channelData.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) {
          max = abs;
        }
      }
      peaks[i] = max;
      if (max > globalMax) {
        globalMax = max;
      }
    }

    // Normalize 0..1
    if (globalMax > 0) {
      for (let i = 0; i < barCount; i++) {
        peaks[i] /= globalMax;
      }
    }

    return peaks;
  } catch {
    return null;
  }
}
