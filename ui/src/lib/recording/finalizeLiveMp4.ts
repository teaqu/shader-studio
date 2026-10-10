/** Convert streaming MP4 fragments into a seekable file without re-encoding. */
export async function finalizeLiveMp4(blob: Blob, signal: AbortSignal): Promise<Blob> {
  const { Input, BlobSource, MP4, Output, Mp4OutputFormat, BufferTarget, Conversion } = await import("mediabunny");
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat({ fastStart: "in-memory" }) });
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  let completed = false;
  const abort = () => {
    void conversion?.cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    conversion = await Conversion.init({ input, output, copy: { mode: "forced" } });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.length || !conversion.utilizedTracks.length) {
      throw new Error("Unable to finalize the Live MP4 recording without losing frames");
    }
    await conversion.execute();
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) {
      throw new Error("Live MP4 finalization produced an empty file");
    }
    completed = true;
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
    if (!completed) {
      await output.cancel();
    }
  }
}
