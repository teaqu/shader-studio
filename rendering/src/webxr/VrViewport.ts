import type { VrEyeView } from "./WebXrFrameData";

/** Scissor keeps a pass's clear/blend operations inside its own eye viewport. */
export function withVrViewport(gl: WebGL2RenderingContext | null, view: VrEyeView, draw: () => void): void {
  if (!gl) {
    throw new Error("Headset rendering requires WebGL2");
  }
  const enabled = gl.isEnabled(gl.SCISSOR_TEST);
  const previous = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
  const { x, y, width, height } = view.viewport;
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, y, width, height);
  try {
    draw();
  } finally {
    gl.scissor(previous[0], previous[1], previous[2], previous[3]);
    if (!enabled) {
      gl.disable(gl.SCISSOR_TEST);
    }
  }
}
