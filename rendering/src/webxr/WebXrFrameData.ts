export interface VrEyeView {
  viewport: { x: number; y: number; width: number; height: number };
  /** Columns encode right/up/forward ray basis and eye origin in reference-space metres. */
  rayTransform: Float32Array;
}

export interface VrControllerData {
  positions: Float32Array;
  directions: Float32Array;
  buttons: Float32Array;
  axes: Float32Array;
}

export function emptyVrControllers(): VrControllerData {
  return { positions: new Float32Array(8), directions: new Float32Array(8), buttons: new Float32Array(8), axes: new Float32Array(8) };
}

/** WebXR projection matrices describe asymmetric perspective frusta, in column-major order. */
export function buildVrEyeView(view: XRView, viewport: XRViewport): VrEyeView {
  const p = view.projectionMatrix;
  const m = view.transform.matrix;
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[5]) || p[0] === 0 || p[5] === 0) {
    throw new Error("Invalid headset projection matrix");
  }
  const rayTransform = new Float32Array(16);
  for (let i = 0; i < 3; i++) {
    rayTransform[i] = m[i] / p[0];
    rayTransform[4 + i] = m[4 + i] / p[5];
    rayTransform[8 + i] = -m[8 + i] + m[i] * p[8] / p[0] + m[4 + i] * p[9] / p[5];
    rayTransform[12 + i] = m[12 + i];
  }
  rayTransform[15] = 1;
  return { viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }, rayTransform };
}

function finite(value: number | undefined, min: number, max: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
}

/** Slot 0 is left, slot 1 right; unhanded sources use the first free slot. */
export function readVrControllers(frame: XRFrame, reference: XRReferenceSpace): VrControllerData {
  const data = emptyVrControllers();
  const occupied = new Set<number>();
  // Reserve handed slots first, independent of the browser's inputSources order.
  const sources = Array.from(frame.session.inputSources).sort((a, b) => Number(a.handedness === "none") - Number(b.handedness === "none"));
  for (const source of sources) {
    const slot = source.handedness === "left" ? 0 : source.handedness === "right" ? 1 : occupied.has(0) ? 1 : 0;
    if (occupied.has(slot)) {
      continue;
    }
    const pose = frame.getPose(source.targetRaySpace, reference);
    if (!pose) {
      continue;
    }
    occupied.add(slot);
    const offset = slot * 4;
    const m = pose.transform.matrix;
    data.positions.set([m[12], m[13], m[14], 1], offset);
    data.directions.set([-m[8], -m[9], -m[10], 1], offset);
    for (let i = 0; i < 4; i++) {
      data.buttons[offset + i] = finite(source.gamepad?.buttons[i]?.value, 0, 1);
      data.axes[offset + i] = finite(source.gamepad?.axes[i], -1, 1);
    }
  }
  return data;
}
