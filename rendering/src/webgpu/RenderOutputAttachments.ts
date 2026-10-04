/** Attachment order is the shader's contiguous colour-location order. */
export function renderOutputAttachments(views: GPUTextureView[]): GPURenderPassColorAttachment[] {
  return views.map(view => ({ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }));
}
