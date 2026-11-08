# Browser script stream examples

Enable **Settings → Enable workspace scripts** in the standalone app, then import these files, including `font.bin`, together using **Workspace → Import files**. Scripts execute in browser workers and cannot use Node modules. Stream shaders need WebGPU and Slang or WGSL.

- `keyboard-comparison.slang`: focus the preview and type. The left side shows the keyboard texture's held, pressed and toggle values for A. The right side counts every ordered script event, repeat and Unicode scalar. Hold A, use Shift, type non-ASCII characters, or paste Unicode text. The event tape preserves order and millisecond timestamps. The texture remains useful for state; it cannot represent a complete text/event history. IME composition support depends on the browser delivering composition events to the canvas.
- `high-volume.slang`: offers 32768 uint32 words every 16 ms (~7.8 MiB/s), retries rejected batches intact, and checks each word plus continuity between frames on the GPU. Green lanes indicate no detected errors; red indicates a gap or ordering error. Numbers are hexadecimal. The throughput display reports whole MiB/s averaged over shader time. Actual throughput depends on the browser and GPU. Pause to build backpressure, then resume. Restart before a long measurement because counters are uint32.

- `high-volume-wgsl.wgsl`: shares the same script producer and displays a 256-column continuity check. Inspect `volumeState[516]` for received words and `[517]` for continuity errors.
Both volume shaders read `samples.length` and `samples.data[i]`; WGSL streams are read-only storage structs.

The keyboard stream uses eight words per event: kind, Unicode scalar, physical key code, modifiers, timestamp in milliseconds, sequence, reserved, reserved. Kinds are down=1, up=2, repeat=3, text=4, release-all=5. Records and frame limits are aligned so a record never spans frames. The source's retry FIFO is bounded and reports overflow rather than silently dropping input.
