import type { OrbitCamera } from "../preview3d/OrbitCamera";
import { createModelMatrix, createNormalMatrix3, multiplyMatrices } from "../preview3d/math";

/** The same viewer transform is used by normal draws and frozen debug captures. */
export function meshUniformData(camera: OrbitCamera, width: number, height: number, useViewerCamera = true): Float32Array {
  const model = createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  const viewProjection = useViewerCamera
    ? multiplyMatrices(camera.getProjectionMatrix(width / Math.max(height, 1), "webgpu"), camera.getViewMatrix())
    : model;
  const normal = createNormalMatrix3(model);
  const data = new Float32Array(64);
  data.set(model, 0);
  data.set(viewProjection, 16);
  data.set([normal[0], normal[1], normal[2], 0, normal[3], normal[4], normal[5], 0, normal[6], normal[7], normal[8], 0, 0, 0, 0, 1], 32);
  data.set(useViewerCamera ? [...camera.getPosition(), 1] : [0, 0, 0, 1], 48);
  return data;
}
