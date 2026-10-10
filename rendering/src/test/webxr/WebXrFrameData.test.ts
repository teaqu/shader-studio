import { describe, expect, it } from "vitest";
import { buildVrEyeView, emptyVrControllers, readVrControllers } from "../../webxr/WebXrFrameData";

const matrix = (values: Partial<Record<number, number>> = {}) => {
  const result = new Float32Array(16);
  result[0] = result[5] = result[10] = result[15] = 1;
  Object.entries(values).forEach(([index, value]) => {
    result[Number(index)] = value!;
  });
  return result;
};

describe("WebXrFrameData", () => {
  it("builds an eye ray basis from the asymmetric projection and copies the viewport", () => {
    const projection = matrix({ 0: 2, 5: 4, 8: .5, 9: -.25 });
    const transform = matrix({ 0: 2, 1: 3, 4: 5, 5: 7, 8: 11, 9: 13, 10: 17, 12: 19, 13: 23, 14: 29 });
    const result = buildVrEyeView({ projectionMatrix: projection, transform: { matrix: transform } } as unknown as XRView, { x: 10, y: 20, width: 30, height: 40 } as XRViewport);
    expect(result.viewport).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(Array.from(result.rayTransform)).toEqual([1, 1.5, 0, 0, 1.25, 1.75, 0, 0, -10.8125, -12.6875, -17, 0, 19, 23, 29, 1]);
  });

  it("rejects invalid headset projection scales", () => {
    for (const value of [0, Number.NaN]) {
      const projection = matrix({ 0: value, 5: 1 });
      expect(() => buildVrEyeView({ projectionMatrix: projection, transform: { matrix: matrix() } } as unknown as XRView, { x: 0, y: 0, width: 1, height: 1 } as XRViewport)).toThrow("Invalid headset projection matrix");
    }
  });

  it("returns independent neutral controller buffers", () => {
    const first = emptyVrControllers();
    first.positions[0] = 1;
    const second = emptyVrControllers();
    expect(Array.from(second.positions)).toEqual(Array(8).fill(0));
    expect([first.directions.length, first.buttons.length, first.axes.length]).toEqual([8, 8, 8]);
  });

  it("orders handed controllers, clamps gamepad values, and skips unavailable poses", () => {
    const pose = (x: number) => ({ transform: { matrix: matrix({ 8: 2, 9: 3, 10: 4, 12: x, 13: x + 1, 14: x + 2 }) } });
    const left = { handedness: "left", targetRaySpace: "left", gamepad: { buttons: [{ value: -1 }, { value: .5 }, { value: 2 }, { value: Number.NaN }], axes: [-2, -.25, .75, 3] } };
    const right = { handedness: "right", targetRaySpace: "right", gamepad: { buttons: [{ value: 1 }], axes: [Number.NaN] } };
    const noPose = { handedness: "none", targetRaySpace: "none" };
    const frame = {
      session: { inputSources: [right, noPose, left] },
      getPose: (space: string) => space === "left" ? pose(10) : space === "right" ? pose(20) : null
    };
    const result = readVrControllers(frame as unknown as XRFrame, {} as XRReferenceSpace);
    expect(Array.from(result.positions)).toEqual([10, 11, 12, 1, 20, 21, 22, 1]);
    expect(Array.from(result.directions)).toEqual([-2, -3, -4, 1, -2, -3, -4, 1]);
    expect(Array.from(result.buttons)).toEqual([0, .5, 1, 0, 1, 0, 0, 0]);
    expect(Array.from(result.axes)).toEqual([-1, -.25, .75, 1, 0, 0, 0, 0]);
  });

  it("assigns unhanded sources to free slots and leaves duplicate hands neutral", () => {
    const source = (handedness: string, id: string) => ({ handedness, targetRaySpace: id });
    const frame = {
      session: { inputSources: [source("left", "left"), source("left", "duplicate"), source("none", "free"), source("none", "extra")] },
      getPose: (space: string) => ({ transform: { matrix: matrix({ 12: space === "left" ? 1 : 2 }) } })
    };
    const result = readVrControllers(frame as unknown as XRFrame, {} as XRReferenceSpace);
    expect(Array.from(result.positions)).toEqual([1, 0, 0, 1, 2, 0, 0, 1]);
  });

  it("leaves an untracked input source neutral", () => {
    const frame = { session: { inputSources: [{ handedness: "none", targetRaySpace: "missing" }] }, getPose: () => null };
    expect(Array.from(readVrControllers(frame as unknown as XRFrame, {} as XRReferenceSpace).positions)).toEqual(Array(8).fill(0));
  });
});
