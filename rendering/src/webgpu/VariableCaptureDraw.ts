import type { CaptureCompileContext } from "../capture/VariableCapturer";
import type { NativeRasterCaptureTarget } from "./NativeRasterCaptureTarget";

export interface CaptureSample {
  gridWidth: number;
  gridHeight: number;
  bytesPerRow: number;
  captureCoord: [number, number];
  isPixelMode: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

/** Encode the authored raster pass before sampling its physical target. */
export function encodeVariableCapture(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup,
  texture: GPUTexture,
  view: GPUTextureView,
  readback: GPUBuffer,
  sample: CaptureSample,
  nativeTarget?: NativeRasterCaptureTarget,
  nativeContext?: CaptureCompileContext["nativeRender"],
): GPUCommandBuffer {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass(nativeTarget ? nativeTarget.attachments() : {
    colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
  });
  try {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    if (nativeContext?.draw) {
      nativeContext.draw(pass);
    } else {
      pass.draw(3);
    }
  } finally {
    pass.end();
  }
  if (nativeTarget) {
    nativeTarget.copy(encoder, readback, sample.gridWidth, sample.gridHeight, sample.bytesPerRow,
      Math.floor(sample.captureCoord[0] * nativeTarget.width / sample.canvasWidth),
      Math.floor((sample.canvasHeight - sample.captureCoord[1]) * nativeTarget.height / sample.canvasHeight),
      sample.isPixelMode);
  } else {
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: sample.bytesPerRow },
      { width: sample.gridWidth, height: sample.gridHeight });
  }
  return encoder.finish();
}
