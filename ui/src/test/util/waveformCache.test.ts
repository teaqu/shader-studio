import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWaveformPeaks } from '../../lib/util/waveformCache';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock OfflineAudioContext
const mockDecodeAudioData = vi.fn();
const MockOfflineAudioContext = vi.fn().mockImplementation(() => ({
  decodeAudioData: mockDecodeAudioData,
}));
vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);

function createMockAudioBuffer(channelData: Float32Array, duration: number) {
  return {
    duration,
    getChannelData: vi.fn().mockReturnValue(channelData),
  };
}

describe('waveformCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWaveformPeaks', () => {
    it('should return peaks for a valid audio URL', async () => {
      const audioData = new Float32Array([0.5, -0.8, 0.3, -0.2, 1.0, -0.6, 0.4, -0.9]);
      const mockBuffer = createMockAudioBuffer(audioData, 1.0);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const peaks = await getWaveformPeaks('http://example.com/audio.mp3', 4);

      expect(peaks).toBeInstanceOf(Float32Array);
      expect(peaks).toHaveLength(4);
      // Peaks should be normalized to 0..1
      expect(Math.max(...Array.from(peaks!))).toBeCloseTo(1.0);
    });

    it('should return cached result on second call', async () => {
      const audioData = new Float32Array([0.5, -1.0, 0.3, -0.2]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const firstResult = await getWaveformPeaks('http://example.com/cached.mp3', 2);
      const secondResult = await getWaveformPeaks('http://example.com/cached.mp3', 2);

      // fetch should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(firstResult).toBe(secondResult);
    });

    it('should deduplicate concurrent requests for the same URL', async () => {
      const audioData = new Float32Array([0.5, -1.0]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      // Fire two requests concurrently
      const [result1, result2] = await Promise.all([
        getWaveformPeaks('http://example.com/dedup.mp3', 2),
        getWaveformPeaks('http://example.com/dedup.mp3', 2),
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2);
    });

    it('should return null when fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await getWaveformPeaks('http://example.com/missing.mp3', 4);

      expect(result).toBeNull();
    });

    it('should return null when fetch rejects', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await getWaveformPeaks('http://example.com/error.mp3', 4);

      expect(result).toBeNull();
    });

    it('should return null when decodeAudioData fails', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockRejectedValue(new Error('Unable to decode audio'));

      const result = await getWaveformPeaks('http://example.com/bad-audio.mp3', 4);

      expect(result).toBeNull();
    });

    it('should use different cache keys for different numPoints', async () => {
      const audioData = new Float32Array([0.5, -1.0, 0.3, -0.2, 0.8, -0.6, 0.1, -0.9]);
      const mockBuffer = createMockAudioBuffer(audioData, 1.0);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const peaks2 = await getWaveformPeaks('http://example.com/diff-numpoints.mp3', 2);
      const peaks4 = await getWaveformPeaks('http://example.com/diff-numpoints.mp3', 4);

      // Should be separate fetches since different numPoints
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(peaks2).toHaveLength(2);
      expect(peaks4).toHaveLength(4);
    });

    it('should not cache failed results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result1 = await getWaveformPeaks('http://example.com/retry.mp3', 2);
      expect(result1).toBeNull();

      // Second attempt should fetch again
      const audioData = new Float32Array([0.5, -1.0]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const result2 = await getWaveformPeaks('http://example.com/retry.mp3', 2);
      expect(result2).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('peak generation logic', () => {
    it('should normalize peaks so max equals 1.0', async () => {
      // Create data where max absolute value is 0.5
      const audioData = new Float32Array([0.5, -0.3, 0.1, -0.2]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const peaks = await getWaveformPeaks('http://example.com/normalize.mp3', 2);

      expect(peaks).not.toBeNull();
      // Max peak should be normalized to 1.0
      const maxPeak = Math.max(...Array.from(peaks!));
      expect(maxPeak).toBeCloseTo(1.0);
    });

    it('should handle silent audio (all zeros)', async () => {
      const audioData = new Float32Array([0, 0, 0, 0]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const peaks = await getWaveformPeaks('http://example.com/silent.mp3', 2);

      expect(peaks).not.toBeNull();
      // All peaks should be 0 for silent audio
      for (const peak of peaks!) {
        expect(peak).toBe(0);
      }
    });

    it('should auto-scale bar count based on duration when numPoints not provided', async () => {
      const audioData = new Float32Array(44100 * 10); // 10 seconds of data
      audioData[0] = 1.0; // at least one non-zero sample
      const mockBuffer = createMockAudioBuffer(audioData, 10.0);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const peaks = await getWaveformPeaks('http://example.com/auto-scale.mp3');

      expect(peaks).not.toBeNull();
      // duration * 4 = 40, clamped between 30 and 200
      expect(peaks!.length).toBe(40);
    });
  });

  describe('auto-scaling boundaries', () => {
    function setupMockAudio(channelData: Float32Array, duration: number) {
      const mockBuffer = createMockAudioBuffer(channelData, duration);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);
    }

    it('should clamp to minimum 30 bars for very short audio', async () => {
      // 1 second * 4 = 4 bars, should clamp to 30
      const audioData = new Float32Array(44100);
      audioData[0] = 1.0;
      setupMockAudio(audioData, 1.0);

      const peaks = await getWaveformPeaks('http://example.com/short.mp3');

      expect(peaks).not.toBeNull();
      expect(peaks!.length).toBe(30);
    });

    it('should clamp to maximum 200 bars for very long audio', async () => {
      // 300 seconds * 4 = 1200 bars, should clamp to 200
      const audioData = new Float32Array(44100 * 300);
      audioData[0] = 1.0;
      setupMockAudio(audioData, 300.0);

      const peaks = await getWaveformPeaks('http://example.com/long.mp3');

      expect(peaks).not.toBeNull();
      expect(peaks!.length).toBe(200);
    });

    it('should produce exactly 30 bars at the lower boundary (7.5 seconds)', async () => {
      // 7.5 * 4 = 30, exactly at the minimum
      const audioData = new Float32Array(44100 * 7.5);
      audioData[0] = 1.0;
      setupMockAudio(audioData, 7.5);

      const peaks = await getWaveformPeaks('http://example.com/boundary-low.mp3');

      expect(peaks).not.toBeNull();
      expect(peaks!.length).toBe(30);
    });

    it('should produce exactly 200 bars at the upper boundary (50 seconds)', async () => {
      // 50 * 4 = 200, exactly at the maximum
      const audioData = new Float32Array(44100 * 50);
      audioData[0] = 1.0;
      setupMockAudio(audioData, 50.0);

      const peaks = await getWaveformPeaks('http://example.com/boundary-high.mp3');

      expect(peaks).not.toBeNull();
      expect(peaks!.length).toBe(200);
    });
  });

  describe('peak accuracy', () => {
    function setupMockAudio(channelData: Float32Array, duration: number) {
      const mockBuffer = createMockAudioBuffer(channelData, duration);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);
    }

    it('should correctly compute peaks with known data', async () => {
      // 4 samples split into 2 windows: [1.0, 0.0] and [0.0, 0.0]
      // Window 0 peak = 1.0, Window 1 peak = 0.0
      // After normalization: [1.0, 0.0]
      const audioData = new Float32Array([1.0, 0.0, 0.0, 0.0]);
      setupMockAudio(audioData, 0.5);

      const peaks = await getWaveformPeaks('http://example.com/known.mp3', 2);

      expect(peaks).not.toBeNull();
      expect(peaks![0]).toBeCloseTo(1.0);
      expect(peaks![1]).toBeCloseTo(0.0);
    });

    it('should handle negative-only samples (abs values taken)', async () => {
      // All negative: [-0.5, -0.8, -0.2, -0.4]
      // 2 windows: [-0.5, -0.8] peak=0.8, [-0.2, -0.4] peak=0.4
      // Normalized: [1.0, 0.5]
      const audioData = new Float32Array([-0.5, -0.8, -0.2, -0.4]);
      setupMockAudio(audioData, 0.5);

      const peaks = await getWaveformPeaks('http://example.com/negative.mp3', 2);

      expect(peaks).not.toBeNull();
      expect(peaks![0]).toBeCloseTo(1.0);
      expect(peaks![1]).toBeCloseTo(0.5);
    });

    it('should handle alternating positive/negative values', async () => {
      // [0.3, -0.6, 0.9, -0.1]
      // 2 windows: [0.3, -0.6] peak=0.6, [0.9, -0.1] peak=0.9
      // Normalized: [0.6/0.9, 1.0] = [0.667, 1.0]
      const audioData = new Float32Array([0.3, -0.6, 0.9, -0.1]);
      setupMockAudio(audioData, 0.5);

      const peaks = await getWaveformPeaks('http://example.com/alternating.mp3', 2);

      expect(peaks).not.toBeNull();
      expect(peaks![0]).toBeCloseTo(0.6 / 0.9);
      expect(peaks![1]).toBeCloseTo(1.0);
    });

    it('should handle single-sample windows', async () => {
      // 4 samples, 4 bars = 1 sample per window
      // [0.2, 0.8, 0.4, 0.6]
      // Normalized: [0.25, 1.0, 0.5, 0.75]
      const audioData = new Float32Array([0.2, 0.8, 0.4, 0.6]);
      setupMockAudio(audioData, 0.5);

      const peaks = await getWaveformPeaks('http://example.com/single-window.mp3', 4);

      expect(peaks).not.toBeNull();
      expect(peaks![0]).toBeCloseTo(0.25);
      expect(peaks![1]).toBeCloseTo(1.0);
      expect(peaks![2]).toBeCloseTo(0.5);
      expect(peaks![3]).toBeCloseTo(0.75);
    });
  });

  describe('concurrent request edge cases', () => {
    it('should handle different URLs concurrently without interference', async () => {
      const audioDataA = new Float32Array([1.0, 0.0]);
      const audioDataB = new Float32Array([0.0, 1.0]);
      const mockBufferA = createMockAudioBuffer(audioDataA, 0.5);
      const mockBufferB = createMockAudioBuffer(audioDataB, 0.5);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        });
      mockDecodeAudioData
        .mockResolvedValueOnce(mockBufferA)
        .mockResolvedValueOnce(mockBufferB);

      const [peaksA, peaksB] = await Promise.all([
        getWaveformPeaks('http://example.com/concurrent-a.mp3', 2),
        getWaveformPeaks('http://example.com/concurrent-b.mp3', 2),
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(peaksA).not.toBeNull();
      expect(peaksB).not.toBeNull();
      // A has peak in first window, B has peak in second window
      expect(peaksA![0]).toBeCloseTo(1.0);
      expect(peaksB![1]).toBeCloseTo(1.0);
    });

    it('should clean up pending entry even on failure (allowing retry)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result1 = await getWaveformPeaks('http://example.com/fail-retry.mp3', 2);
      expect(result1).toBeNull();

      // After failure, pending should be cleaned up so a retry can proceed
      const audioData = new Float32Array([1.0, -1.0]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      const result2 = await getWaveformPeaks('http://example.com/fail-retry.mp3', 2);
      expect(result2).not.toBeNull();
      expect(result2!.length).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle a slow first request and a fast second request to different URLs', async () => {
      const slowData = new Float32Array([0.5, -0.5]);
      const fastData = new Float32Array([1.0, -1.0]);
      const slowBuffer = createMockAudioBuffer(slowData, 0.5);
      const fastBuffer = createMockAudioBuffer(fastData, 0.5);

      // Slow request takes longer
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('slow')) {
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
                }),
              50,
            ),
          );
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        });
      });

      mockDecodeAudioData
        .mockResolvedValueOnce(fastBuffer)
        .mockResolvedValueOnce(slowBuffer);

      vi.useFakeTimers();

      // Start slow first, then fast
      const slowPromise = getWaveformPeaks('http://example.com/slow.mp3', 2);
      const fastPromise = getWaveformPeaks('http://example.com/fast.mp3', 2);

      const fastResult = await fastPromise;
      await vi.advanceTimersByTimeAsync(51);
      const slowResult = await slowPromise;

      vi.useRealTimers();

      expect(fastResult).not.toBeNull();
      expect(slowResult).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
