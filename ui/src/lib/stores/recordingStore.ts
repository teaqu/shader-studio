import { writable } from "svelte/store";

export interface RecordingState {
  isRecording: boolean;
  isFinalizing: boolean;
  finalizingStartTime: number; // performance.now() when finalizing started
  progress: number; // 0–1
  currentFrame: number;
  totalFrames: number;
  format: "webm" | "mp4" | "gif" | null;
  error: string | null;
  previewCanvas: HTMLCanvasElement | null;
}

const initial: RecordingState = {
  isRecording: false,
  isFinalizing: false,
  finalizingStartTime: 0,
  progress: 0,
  currentFrame: 0,
  totalFrames: 0,
  format: null,
  error: null,
  previewCanvas: null,
};

function createRecordingStore() {
  const { subscribe, set, update } = writable<RecordingState>(initial);

  return {
    subscribe,
    startRecording(format: "webm" | "mp4" | "gif", totalFrames: number) {
      update((s) => ({
        ...s,
        isRecording: true,
        isFinalizing: false,
        progress: 0,
        currentFrame: 0,
        totalFrames,
        format,
        error: null,
      }));
    },
    updateProgress(currentFrame: number, totalFrames: number) {
      update((s) => ({
        ...s,
        currentFrame,
        totalFrames,
        progress: totalFrames > 0 ? currentFrame / totalFrames : 0,
      }));
    },
    setFinalizing() {
      update((s) => ({ ...s, isFinalizing: true, finalizingStartTime: performance.now() }));
    },
    setError(error: string) {
      update((s) => ({ ...s, error, isRecording: false, isFinalizing: false }));
    },
    setPreviewCanvas(canvas: HTMLCanvasElement | null) {
      update((s) => ({ ...s, previewCanvas: canvas }));
    },
    reset() {
      set({ ...initial });
    },
  };
}

export const recordingStore = createRecordingStore();
