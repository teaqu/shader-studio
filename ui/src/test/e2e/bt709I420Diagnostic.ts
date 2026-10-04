/** Explicit limited-range BT709 planes for a diagnostic comparison, not product capture. */
export function bt709I420Planes(image: ImageData, matrix: "bt709" | "smpte170m" = "bt709"): Uint8Array {
  const { width, height, data: rgba } = image;
  const kr = matrix === "bt709" ? .2126 : .299;
  const kb = matrix === "bt709" ? .0722 : .114;
  const kg = 1 - kr - kb;
  if (width % 2 || height % 2) {
    throw new Error("I420 diagnostics require even dimensions");
  }
  const pixels = width * height;
  const planes = new Uint8Array(pixels * 3 / 2);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 4;
    const luma = kr * rgba[offset] + kg * rgba[offset + 1] + kb * rgba[offset + 2];
    planes[pixel] = Math.round(16 + 219 * luma / 255);
  }
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let r = 0; let g = 0; let b = 0;
      for (const offset of [(y * width + x) * 4, (y * width + x + 1) * 4, ((y + 1) * width + x) * 4, ((y + 1) * width + x + 1) * 4]) {
        r += rgba[offset] / 4; g += rgba[offset + 1] / 4; b += rgba[offset + 2] / 4;
      }
      const luma = kr * r + kg * g + kb * b;
      const chroma = y / 2 * (width / 2) + x / 2;
      planes[pixels + chroma] = Math.round(128 + 224 * (b - luma) / (2 * 255 * (1 - kb)));
      planes[pixels * 5 / 4 + chroma] = Math.round(128 + 224 * (r - luma) / (2 * 255 * (1 - kr)));
    }
  }
  return planes;
}

export async function encodeBt709I420Diagnostic(image: ImageData, fps: number): Promise<Blob> {
  const { Output, BufferTarget, Mp4OutputFormat, VideoSample, VideoSampleSource, Quality } = await import("mediabunny");
  const { automaticVideoBitrate } = await import("../../lib/recording/VideoEncoder");
  const { width, height } = image;
  const planes = bt709I420Planes(image);
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: "in-memory" }) });
  const source = new VideoSampleSource({
    codec: "avc", quality: new Quality({ quantizer: 12, bitrate: automaticVideoBitrate({ width, height, fps }) }),
    latencyMode: "quality", contentHint: "detail",
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let frame = 0; frame < 32; frame++) {
      const sample = new VideoSample(planes, {
        format: "I420", codedWidth: width, codedHeight: height, timestamp: frame / fps, duration: 1 / fps,
        colorSpace: { fullRange: false, matrix: "bt709", primaries: "bt709", transfer: "iec61966-2-1" },
        layout: [{ offset: 0, stride: width }, { offset: width * height, stride: width / 2 }, { offset: width * height * 5 / 4, stride: width / 2 }],
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
    }
    source.close();
    await output.finalize();
    return new Blob([target.buffer!], { type: "video/mp4" });
  } finally {
    if (output.state !== "finalized") {
      await output.cancel();
    }
  }
}
