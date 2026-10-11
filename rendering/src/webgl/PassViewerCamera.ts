import type { Pass } from '../models';
import type { CameraMatrices } from '../preview3d/OrbitCamera';
import { createModelMatrix } from '../preview3d/math';
import { resolveRenderState } from '../types/Geometry';

export function passCameraMatrices(camera: CameraMatrices, enabled = true): CameraMatrices {
  if (enabled) {
    return camera;
  }
  const identity = createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  return { view: identity, projection: identity, viewProjection: identity };
}

export function passCameraRenderState(pass: Pass) {
  const state = resolveRenderState(pass);
  if (pass.useViewerCamera === false && state.depth?.compare === 'less') {
    state.depth.compare = 'less-equal';
  }
  return state;
}
