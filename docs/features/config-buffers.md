# Configure Passes and Inputs

The config panel is where you set up multi-pass pipelines and bind assets to shader inputs. Everything is stored in a `.sha.json` file that the visual editor writes for you.

## Opening the Config Panel

Click the <i class="codicon codicon-gear"></i> **Config** button in the toolbar.

![Config panel](../assets/images/config.png)

---

## The Pass Tab Bar

The tab bar at the top shows every pass in your shader. Click **+ New** to add a pass. Remove a pass with the `×` on its tab (Image cannot be removed).

![Config pass tab bar](../assets/images/config-tabs.png)

| Tab | Description |
|-----|-------------|
| **Image** | Always present. The final rendered output. No file path — this is your `mainImage` shader. |
| **Named buffer pass** | An intermediate fragment render pass backed by a `.glsl` or `.slang` file. Names and pass counts are unrestricted. |
| **Compute\*** | A Slang/WebGPU compute pass backed by a `.slang` file. Compute fields are edited in raw `.sha.json`. |
| **Common** | Shared GLSL or Slang included at the top of every pass. Not a render pass — has no framebuffer. |
| **Script** | A TypeScript or JavaScript file that drives custom `uniform` values per frame. |

!!! note
    When editing buffer files, use the <i class="codicon codicon-lock"></i> **Lock** button to keep the preview pinned to your Image pass. See [Locking](locking.md).

---

## The Image Pass

The Image tab has no file path — it always corresponds to your main shader file. You can set a default resolution here:

| Setting | Options | Description |
|---------|---------|-------------|
| **Scale** | 0.25×, 0.5×, 1×, 2×, 4× | Relative to the panel size |
| **Aspect ratio** | 16:9, 4:3, 1:1, Fill, Auto | Constrains the canvas shape. Auto uses your screen's aspect ratio. |
| **Custom dimensions** | e.g. `1920 × 1080` | Base width and height in pixels |

The Image pass can also have input channels (`iChannel0`–`iChannel15`). See [Channels](channels.md) for how to bind textures, video, audio, and more.

See [Resolution](resolution.md) for how these settings interact with the toolbar.

- `scale` and `width` / `height` are composable. For example, `width: 320`, `height: 180`, `scale: 2` renders as `640 × 360`.

---

## Buffer Passes

Each fragment buffer pass renders a `.glsl` or `.slang` file to an offscreen framebuffer that other passes can read as a texture. Buffer pass names are ordinary identifiers such as `Flow`, `BloomHorizontal`, or `BufferA`; there is no `BufferA`–`BufferD` name set or four-pass limit. You can also configure input channels (`iChannel0`–`iChannel15`) for each pass. See [Channels](channels.md) for how to bind textures, video, audio, and more.

**Path field** — points to the shader file for this buffer. Three path forms are supported:

| Form | Example | Resolves relative to |
|------|---------|----------------------|
| Relative | `passes/flow.slang` | The main shader file |
| Absolute | `/Users/me/project/flow.glsl` | Filesystem root |
| Workspace-root | `@/src/flow.glsl` | VS Code workspace root |

If the file doesn't exist yet, the editor shows a **Create File** button that generates it with a `mainImage` stub.

**Resolution** (optional) — by default a buffer inherits the Image pass resolution exactly. You can override this in two ways:

| Mode | Example | Description |
|------|---------|-------------|
| **Fixed** | `512 × 512` | Exact pixel dimensions, independent of the canvas |
| **Scale** | `0.5×` | Multiplier on the Image resolution — tracks canvas changes |

---

## Compute Passes

For a Slang shader, a pass name beginning with `Compute` selects the WebGPU compute pipeline. The **+ Compute** action adds a pass entry; give it a `.slang` path and create that file with a `computeMain` function. Storage declarations and fields such as `dispatch`, `dispatchCount`, `dispatchOnce`, `workgroupSize`, and `outputLayers` are currently edited in the raw `.sha.json` view.

See [Compute Passes](compute.md) for the authoring convention, storage layout rules, and executable examples.

---

## The Script Pass

The Script pass supplies current uniform values and ordered data streams from a TypeScript or JavaScript file. It has no framebuffer. Uniforms work with GLSL/WebGL and Slang/WebGPU; streams require Slang/WebGPU.

### Exporting Uniforms

Export `uniforms(ctx)` for current values, `streams(ctx)` for queued inputs, or both. Each returns an object whose keys become shader input names. The uniforms function is polled; the streams function runs once per script load.

```typescript
// shader.uniforms.ts
export function uniforms(ctx: {
  iTime: number;
  iFrame: number;
  iTimeDelta: number;
  iFrameRate: number;
  iResolution: [number, number, number];
  iMouse: [number, number, number, number];
  iDate: [number, number, number, number];
  iSampleRate: number;
  iChannelTime: [number, number, number, number];
}) {
  return {
    uSpeed:   ctx.iTime * 0.5,
    uColor:   [Math.sin(ctx.iTime), 0.5, 1.0] as [number, number, number],
    uEnabled: true,
  };
}
```

### Type Inference

Types are inferred from the return value on the first call. The returned values are **injected as GLSL uniforms automatically** — no declaration needed in your shader.

| Return type | GLSL uniform |
|-------------|-------------|
| `number` | `uniform float uSpeed;` |
| `[n, n]` | `uniform vec2 uOffset;` |
| `[n, n, n]` | `uniform vec3 uColor;` |
| `[n, n, n, n]` | `uniform vec4 uRect;` |
| `boolean` | `uniform bool uEnabled;` |

### Polling Rate

The **Max Polling Rate** slider (1–120 fps) controls how often `uniforms(ctx)` runs. Stream delivery follows rendered frames independently. The config panel shows the actual vs. target polling rate for each uniform.

For slowly-changing values, 1–10 fps is usually enough. High rates consume more CPU.

### Using Node.js APIs

Scripts run in Node.js and can `require()` any module. Modules resolve from the script file's own directory.

```typescript
import * as fs from 'fs';

export function uniforms(ctx) {
  const data = JSON.parse(fs.readFileSync('./params.json', 'utf8'));
  return { uValue: data.value };
}
```

Because the script runs in Node.js, you can pull in values from anywhere — game controllers, serial ports, external hardware, WebSockets, OS sensors, or any npm package. For example, you could read a gamepad with a library like `node-hid`, stream data from a microcontroller over serial, or poll an external API for live data.

!!! warning
    Do not name script uniforms the same as built-ins (`iTime`, `iResolution`, `iChannel0`, etc.). The script will fail to load with an error listing the collision.

---

## The Common Pass

The Common pass points to a `.glsl` or `.slang` file whose contents are prepended to every other pass before compilation. Use it for shared utility functions, constants, and type definitions.

```glsl
// shader.common.glsl — available in Image, BufferA, etc.
#define PI 3.14159265359

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
```

You can then use `hash`, `noise`, or `PI` in any Image or named buffer pass.

!!! note
    Common is not rendered — it has no framebuffer. It is purely a code injection, equivalent to a `#include`.

---

## Other: Editing the Config File Directly

The config is stored as JSON in a `.sha.json` file with the same base name as the shader (`myshader.glsl` or `myshader.slang` → `myshader.sha.json`), in the same directory. You can edit it directly in VS Code — the visual editor and the raw file stay in sync.

!!! tip
    The config panel has a toggle to switch between the visual editor and raw JSON view.

See [Config File Format](../help/config-file.md) for the full schema reference.

## Next

[Channels](channels.md) — bind textures, video, audio, cubemaps, buffers, and keyboard input

### Integer and array uniforms

Use `ctx.int(value)` and `ctx.uint(value)` for exact 32-bit integers. Use
`ctx.floatArray([...])`, `ctx.intArray([...])`, or `ctx.uintArray([...])` for
fixed-length scalar arrays (1–1024 elements). Plain arrays of length 2–4 still
mean vectors. Types and lengths are fixed at load; reload to change them.
Integer values outside their 32-bit range, fractional integers, and non-finite
numbers are rejected. The Script tab shows exact integer values and expandable arrays.

```js
export function uniforms(ctx) {
  return {
    tick: ctx.uint(ctx.iFrame),
    mode: ctx.int(-1),
    weights: ctx.floatArray([0.25, 0.5, 0.75]),
    ids: ctx.uintArray([123, 4294967295]),
  };
}
```

### Script streams

```js
export function streams(ctx) {
  const net = ctx.stream({ maxPerFrame: 4096, maxQueued: 65536 });
  const uart = ctx.stream({ maxPerFrame: 64 });
  const socket = new WebSocket('ws://localhost:9000');
  socket.binaryType = 'arraybuffer';
  socket.onmessage = ({ data }) => {
    // The source protocol supplies aligned uint32 words.
    if (!net.push(new Uint32Array(data))) console.warn('Queue full');
  };
  ctx.onDispose(() => socket.close());
  return { net, uart };
}
```

Both inputs bind automatically. No stream declarations are needed in `.sha.json`:

```slang
for (uint i = 0; i < net.length; i++) {
    handle(net.data[i]);
}
```

- `push()` copies unsigned 32-bit words. Invalid words throw. A full queue rejects
  the entire push and returns `false`; the script decides whether to retry or slow
  its source. Accepted data is never silently dropped during ordinary delivery.
- `maxPerFrame` defaults to 4096 (range 1–65536). `maxQueued` defaults to at least
  65536 words (maximum 1048576), and must hold at least one frame.
- Each rendered frame gets up to the limit, in order. All passes see the same
  chunk. Empty frames have length zero. Paused/skipped frames retain queued data;
  capture does not consume live stream input.
- Each preview has an independent delivery cursor. A newly joining preview sees
  future pushes. A slow preview can backpressure the shared source. Closing a
  preview releases its cursor.
- Reset clears queues; script reload closes registered sources, clears queues,
  and calls `streams(ctx)` again. Register connection cleanup with `onDispose`.
  Script-created timers are also stopped automatically. Old producers cannot push
  into a new script load.
- Stream names must be unique across uniforms, streams, channels, and storage.
  Up to eight streams are supported, subject to device storage binding limits.
- Scripts continue to run in the extension's Node host, including for its hosted
  browser previews. Browser-only standalone and vscode.dev script runtimes are
  not introduced here. Native WebSocket availability depends on the host Node
  version; scripts can also import their own Node networking library.
- Stream data is live input; deterministic stream recording/replay is not yet provided.

The runnable `examples/script-streams/stream-demo.slang` example uses two streams
and typed uniforms without an external server.
