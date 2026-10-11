export interface RenderFrameStep {
  time: number;
  frame: number;
  delta: number;
}

export interface RenderTimeline {
  /** Frames rendered from time zero before the first output frame. */
  preparationCount: number;
  preparationStep(index: number): RenderFrameStep;
  outputStep(index: number): RenderFrameStep;
}

const GRID_EPSILON = 1e-9;
/** Longest supported start time: preparation renders every frame from zero. */
export const MAX_CAPTURE_START_TIME = 3600;

export function createRenderTimeline(startTime: number, fps: number): RenderTimeline {
  if (!Number.isFinite(startTime) || startTime < 0) {
    throw new Error("Capture start time must be a finite non-negative number");
  }
  if (startTime > MAX_CAPTURE_START_TIME) {
    throw new Error(`Capture start time must be ${MAX_CAPTURE_START_TIME} s or less`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Capture frame rate must be a finite positive number");
  }

  const dt = 1 / fps;
  const preparationCount = startTime === 0
    ? 0
    : Math.ceil(startTime * fps - GRID_EPSILON);
  const previousTime = preparationCount === 0 ? undefined : (preparationCount - 1) * dt;
  const firstDelta = previousTime === undefined ? 0 : startTime - previousTime;

  return {
    preparationCount,
    preparationStep(index: number): RenderFrameStep {
      if (!Number.isInteger(index) || index < 0 || index >= preparationCount) {
        throw new Error("Preparation frame index is out of range");
      }
      return { time: index * dt, frame: index, delta: index === 0 ? 0 : dt };
    },
    outputStep(index: number): RenderFrameStep {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error("Capture frame index must be a non-negative integer");
      }
      return {
        time: startTime + index * dt,
        frame: preparationCount + index,
        delta: index === 0 ? firstDelta : dt,
      };
    },
  };
}
