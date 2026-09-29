import { writable } from "svelte/store";

export type CapturePhase = "idle" | "preparing" | "rendering" | "recording" | "finalizing" | "saving" | "error";
export type CaptureFormat = "png" | "jpeg" | "webm" | "mp4" | "gif";

export interface RecordingState {
  phase: CapturePhase;
  isRecording: boolean;
  isLive: boolean;
  isPreparing: boolean;
  isFinalizing: boolean;
  finalizingStartTime: number; // performance.now() when finalizing started
  progress: number; // 0–1
  currentFrame: number;
  totalFrames: number;
  preparationFrame: number;
  preparationFrames: number;
  format: CaptureFormat | null;
  error: string | null;
  previewCanvas: HTMLCanvasElement | null;
}

const initial: RecordingState = {
  phase: "idle",
  isRecording: false,
  isLive: false,
  isPreparing: false,
  isFinalizing: false,
  finalizingStartTime: 0,
  progress: 0,
  currentFrame: 0,
  totalFrames: 0,
  preparationFrame: 0,
  preparationFrames: 0,
  format: null,
  error: null,
  previewCanvas: null,
};

function createRecordingStore() {
  const { subscribe, set, update } = writable<RecordingState>(initial);

  return {
    subscribe,
    startPreparing(format: CaptureFormat, totalFrames: number, preparationFrames: number) {
      update((s) => ({
        ...s,
        phase: "preparing",
        isRecording: true,
        isLive: false,
        isPreparing: true,
        isFinalizing: false,
        progress: 0,
        currentFrame: 0,
        totalFrames,
        preparationFrame: 0,
        preparationFrames,
        format,
        error: null,
      }));
    },
    updatePreparation(currentFrame: number, totalFrames: number) {
      update((s) => ({
        ...s,
        preparationFrame: currentFrame,
        preparationFrames: totalFrames,
        progress: totalFrames > 0 ? currentFrame / totalFrames : 0,
      }));
    },
    startLiveRecording(format: "webm" | "mp4") {
      update((s) => ({
        ...s,
        phase: "recording",
        isRecording: true,
        isLive: true,
        isPreparing: false,
        isFinalizing: false,
        progress: 0,
        currentFrame: 0,
        totalFrames: 0,
        preparationFrame: 0,
        preparationFrames: 0,
        format,
        error: null,
      }));
    },
    startRecording(format: CaptureFormat, totalFrames: number) {
      update((s) => ({
        ...s,
        phase: "rendering",
        isRecording: true,
        isLive: false,
        isPreparing: false,
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
      update((s) => ({
        ...s,
        phase: "finalizing",
        isPreparing: false,
        isFinalizing: true,
        finalizingStartTime: performance.now(),
      }));
    },
    setSaving(format: CaptureFormat) {
      update((s) => ({
        ...s,
        phase: "saving",
        isRecording: true,
        isLive: false,
        isPreparing: false,
        isFinalizing: false,
        format,
        error: null,
      }));
    },
    setError(error: string) {
      update((s) => ({
        ...s,
        phase: "error",
        error,
        isRecording: false,
        isLive: false,
        isPreparing: false,
        isFinalizing: false,
      }));
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
