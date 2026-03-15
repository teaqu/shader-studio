import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { recordingStore, type RecordingState } from '../../lib/stores/recordingStore';

function getState(): RecordingState {
  let state!: RecordingState;
  recordingStore.subscribe((s) => (state = s))();
  return state;
}

describe('recordingStore', () => {
  beforeEach(() => {
    recordingStore.reset();
  });

  it('should have correct initial state', () => {
    const state = getState();
    expect(state).toEqual({
      isRecording: false,
      isFinalizing: false,
      finalizingStartTime: 0,
      progress: 0,
      currentFrame: 0,
      totalFrames: 0,
      format: null,
      error: null,
      previewCanvas: null,
    });
  });

  describe('startRecording', () => {
    it('should set recording state for webm', () => {
      recordingStore.startRecording('webm', 300);
      const state = getState();
      expect(state.isRecording).toBe(true);
      expect(state.isFinalizing).toBe(false);
      expect(state.format).toBe('webm');
      expect(state.totalFrames).toBe(300);
      expect(state.progress).toBe(0);
      expect(state.currentFrame).toBe(0);
      expect(state.error).toBeNull();
    });

    it('should set recording state for mp4', () => {
      recordingStore.startRecording('mp4', 600);
      const state = getState();
      expect(state.isRecording).toBe(true);
      expect(state.format).toBe('mp4');
      expect(state.totalFrames).toBe(600);
    });

    it('should set recording state for gif', () => {
      recordingStore.startRecording('gif', 150);
      const state = getState();
      expect(state.isRecording).toBe(true);
      expect(state.format).toBe('gif');
      expect(state.totalFrames).toBe(150);
    });

    it('should clear previous error', () => {
      recordingStore.setError('previous error');
      recordingStore.startRecording('mp4', 100);
      expect(getState().error).toBeNull();
    });

    it('should preserve previewCanvas when starting recording', () => {
      const canvas = document.createElement('canvas');
      recordingStore.setPreviewCanvas(canvas);
      recordingStore.startRecording('mp4', 100);
      expect(getState().previewCanvas).toBe(canvas);
    });
  });

  describe('updateProgress', () => {
    it('should update current frame and progress', () => {
      recordingStore.startRecording('webm', 100);
      recordingStore.updateProgress(50, 100);
      const state = getState();
      expect(state.currentFrame).toBe(50);
      expect(state.totalFrames).toBe(100);
      expect(state.progress).toBe(0.5);
    });

    it('should handle progress at completion', () => {
      recordingStore.startRecording('mp4', 200);
      recordingStore.updateProgress(200, 200);
      expect(getState().progress).toBe(1);
    });

    it('should handle zero total frames', () => {
      recordingStore.updateProgress(0, 0);
      expect(getState().progress).toBe(0);
    });

    it('should allow totalFrames to change', () => {
      recordingStore.startRecording('gif', 100);
      recordingStore.updateProgress(10, 200);
      const state = getState();
      expect(state.totalFrames).toBe(200);
      expect(state.progress).toBe(0.05);
    });
  });

  describe('setFinalizing', () => {
    it('should set isFinalizing to true', () => {
      recordingStore.startRecording('webm', 100);
      recordingStore.setFinalizing();
      expect(getState().isFinalizing).toBe(true);
    });
  });

  describe('setError', () => {
    it('should set error and stop recording', () => {
      recordingStore.startRecording('mp4', 100);
      recordingStore.setError('Encoding failed');
      const state = getState();
      expect(state.error).toBe('Encoding failed');
      expect(state.isRecording).toBe(false);
      expect(state.isFinalizing).toBe(false);
    });

    it('should clear finalizing state on error', () => {
      recordingStore.startRecording('webm', 100);
      recordingStore.setFinalizing();
      recordingStore.setError('Failed');
      const state = getState();
      expect(state.isFinalizing).toBe(false);
      expect(state.isRecording).toBe(false);
    });
  });

  describe('setPreviewCanvas', () => {
    it('should set preview canvas', () => {
      const canvas = document.createElement('canvas');
      recordingStore.setPreviewCanvas(canvas);
      expect(getState().previewCanvas).toBe(canvas);
    });

    it('should clear preview canvas with null', () => {
      const canvas = document.createElement('canvas');
      recordingStore.setPreviewCanvas(canvas);
      recordingStore.setPreviewCanvas(null);
      expect(getState().previewCanvas).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const canvas = document.createElement('canvas');
      recordingStore.setPreviewCanvas(canvas);
      recordingStore.startRecording('mp4', 300);
      recordingStore.updateProgress(150, 300);
      recordingStore.setFinalizing();

      recordingStore.reset();
      const state = getState();
      expect(state.isRecording).toBe(false);
      expect(state.isFinalizing).toBe(false);
      expect(state.progress).toBe(0);
      expect(state.currentFrame).toBe(0);
      expect(state.totalFrames).toBe(0);
      expect(state.format).toBeNull();
      expect(state.error).toBeNull();
      expect(state.previewCanvas).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers on changes', () => {
      const states: RecordingState[] = [];
      const unsubscribe = recordingStore.subscribe((s) => states.push(s));

      recordingStore.startRecording('gif', 50);
      recordingStore.updateProgress(25, 50);

      // Initial + startRecording + updateProgress = 3
      expect(states.length).toBe(3);
      expect(states[1].format).toBe('gif');
      expect(states[2].currentFrame).toBe(25);

      unsubscribe();
    });
  });
});
