import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWaveformPeaks, clearWaveformCache } from '../../lib/util/waveformCache';

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
    clearWaveformCache();
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

      const peaks2 = await getWaveformPeaks('http://example.com/audio.mp3', 2);
      const peaks4 = await getWaveformPeaks('http://example.com/audio.mp3', 4);

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

  describe('clearWaveformCache', () => {
    it('should clear all cached entries when called without arguments', async () => {
      const audioData = new Float32Array([1.0, -1.0]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      await getWaveformPeaks('http://example.com/a.mp3', 2);
      await getWaveformPeaks('http://example.com/b.mp3', 2);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      clearWaveformCache();

      // After clearing, both should re-fetch
      await getWaveformPeaks('http://example.com/a.mp3', 2);
      await getWaveformPeaks('http://example.com/b.mp3', 2);

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should clear only the specified URL entry', async () => {
      const audioData = new Float32Array([1.0, -1.0]);
      const mockBuffer = createMockAudioBuffer(audioData, 0.5);

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      mockDecodeAudioData.mockResolvedValue(mockBuffer);

      await getWaveformPeaks('http://example.com/a.mp3', 2);
      await getWaveformPeaks('http://example.com/b.mp3', 2);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Clear only 'a' — note the cache key includes numPoints
      clearWaveformCache('http://example.com/a.mp3:2');

      await getWaveformPeaks('http://example.com/a.mp3', 2);
      await getWaveformPeaks('http://example.com/b.mp3', 2);

      // Only 'a' should re-fetch (3 total), 'b' should still be cached
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
