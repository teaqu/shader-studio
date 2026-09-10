# GLSL / Slang functional parity fixtures

Open each `_glsl.glsl` and `.slang` pair in Shader Studio. Green output means
the shared contract is satisfied; red identifies a parity failure.

| Fixture | Contract | Manual action |
| --- | --- | --- |
| `channels/named*` | Custom config names bind and sample the same texture. | None. |
| `pass-timing/timing*` | A later buffer reads an earlier buffer's current-frame output. | Open `timing.slang` or `timing_glsl.glsl` and let it run. The `b*` files also have standalone companion configs for direct inspection. |
| `reset-feedback/reset*` | Reset clears both feedback targets before frame zero. | Let it turn blue, then press Reset; it must flash green, never red. |
| `resize-feedback/resize*` | Resizing preserves accumulated feedback. | Wait for the green circle, then resize either backend repeatedly while keeping the preview above 96×96. It must stay at 64×64 pixels from the bottom-left and never show red. |
| `pixel-inspector/gradient*` | Inspector values always belong to the current coordinate. | Sweep rapidly, then stop on a corner or center; compare RGB with normalized coordinates. |
