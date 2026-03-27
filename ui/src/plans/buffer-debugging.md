# Buffer Pass Debugging Plan

## Goal

Enable line debugging and variable inspection on buffer passes (BufferA/B/C/D) and the `common` shared-include — not just the Image pass.

---

## Core Insight: No Rendering Changes Needed

The debug transpiler already handles all the required cases:

| Source | Entry point | Transpiler path |
|---|---|---|
| Image pass | `mainImage` | truncate at line, output to fragColor |
| Buffer pass (BufferA, etc.) | `mainImage` | **same** — identical function signature |
| Common file | helper functions, no `mainImage` | helper function wrapping path already generates a `mainImage` wrapper |

So the approach is simply: **when the cursor is in a buffer or common file, pass that file's code as the source to `modifyShaderForDebugging()` and use the result as the Image pass.** No blit, no pipeline changes, no new rendering code.

Buffer `iChannel` inputs are properly bound by also passing the buffer's own `inputs` config as the Image pass config — so `withBufferInputsAsImage` replaces `passes.Image.inputs` with the target buffer's inputs before calling `compileShaderPipeline`. No texture bindings are lost.

---

## What Changes

### Step 1 — Relax cursor tracking to accept buffer files

**Files**: `ui/src/lib/util/BufferUpdater.ts`, `ui/src/lib/transport/MessageHandler.ts`

`MessageHandler` already has a `this.bufferUpdater: BufferUpdater` instance. `BufferUpdater` already has `bufferFileExistsInCurrentShader(filePath)` (private) and `getBufferNameForFilePath(filePath)` (private) — these use `renderEngine.getPasses()` / `renderEngine.getCurrentConfig()` and already contain exactly the path-matching logic needed. **Make both methods public** instead of duplicating.

In `handleCursorPositionMessage`, change:
```typescript
// OLD
if (lockedPath && filePath !== lockedPath) return;
// NEW — locked Image file accepted by the lockedPath === filePath check;
//        buffer/common files accepted by bufferUpdater
if (lockedPath && filePath !== lockedPath && !this.bufferUpdater.bufferFileExistsInCurrentShader(filePath)) return;
```

Same change for the inline cursor inside `handleShaderMessage` (the `if (!this.shaderLocker.isLocked() || ...)` guard on line 65):
```typescript
// OLD
if (!this.shaderLocker.isLocked() || this.shaderLocker.getLockedShaderPath() === filePath) {
// NEW
if (!this.shaderLocker.isLocked() || this.shaderLocker.getLockedShaderPath() === filePath
    || this.bufferUpdater.bufferFileExistsInCurrentShader(filePath)) {
```

---

### Step 2 — Add `activeBufferName` to state

**File**: `ui/src/lib/types/ShaderDebugState.ts`

```typescript
export interface ShaderDebugState {
  // ... existing fields ...
  activeBufferName: string;   // "Image" | "BufferA" | "BufferB" | "common" etc.
}
```

Initial value: `'Image'`.

---

### Step 3 — Buffer resolution in ShaderDebugManager

**File**: `ui/src/lib/ShaderDebugManager.ts`

`ShaderDebugManager` needs to know which buffer a given file path belongs to. Add:

```typescript
private shaderConfig: ShaderConfig | null = null;
private imagePassPath: string | null = null;
private bufferPathMap: Record<string, string> = {}; // bufferName → filePath
private bufferCodes: Record<string, string> = {};

public setShaderContext(
  config: ShaderConfig | null,
  imagePath: string | null,
  buffers: Record<string, string>,
): void {
  this.shaderConfig = config;
  this.imagePassPath = imagePath;
  this.bufferCodes = buffers;
  this.bufferPathMap = {};
  const passes = config?.passes ?? {};
  for (const [name, pass] of Object.entries(passes)) {
    if ('path' in pass && pass.path) {
      this.bufferPathMap[name] = pass.path;
    }
  }
}

private resolveActiveBuffer(filePath: string | null): string {
  if (!filePath) return 'Image';
  if (this.imagePassPath && filePath === this.imagePassPath) return 'Image';
  for (const [name, path] of Object.entries(this.bufferPathMap)) {
    if (filePath === path || filePath.endsWith(path)) return name;
  }
  return 'Image'; // fallback
}

public getActiveCode(imageCode: string): string {
  if (this.state.activeBufferName === 'Image') return imageCode;
  return this.bufferCodes[this.state.activeBufferName] ?? imageCode;
}
```

Update `updateDebugLine()` to also set `activeBufferName`:
```typescript
this.state.activeBufferName = this.resolveActiveBuffer(filePath);
```

Update `updateFunctionContext()` to use the active buffer's code instead of always using `lastOriginalCode`:
```typescript
private updateFunctionContext(): void {
  const codeToAnalyse = this.getActiveCode(this.lastOriginalCode ?? '');
  if (!codeToAnalyse || this.state.currentLine === null) { ... }
  const context = ShaderDebugger.extractFunctionContext(codeToAnalyse, this.state.currentLine);
  // ...
}
```

---

### Step 4 — Call setShaderContext from MessageHandler

**File**: `ui/src/lib/transport/MessageHandler.ts`

In `processMainShaderCompilation()`, before delegating to ShaderProcessor:

```typescript
this.shaderDebugManager.setShaderContext(
  message.config ?? null,
  message.path,
  message.buffers ?? {},
);
```

---

### Step 5 — ShaderProcessor passes the right source code and config

**File**: `ui/src/lib/ShaderProcessor.ts`

Replace `getDebugCodeToCompile(originalCode)` with a richer method that also returns a (potentially modified) config so the buffer's own iChannel inputs get bound correctly:

```typescript
private getDebugCompileArgs(
  originalCode: string,
  config: ShaderConfig | null,
): { code: string; config: ShaderConfig | null } {
  const state = this.shaderDebugManager.getState();

  // Resolve the active source — buffer/common code or Image code
  const sourceCode = this.shaderDebugManager.getActiveCode(originalCode);
  const debugConfig = this.withBufferInputsAsImage(config, state.activeBufferName);

  if (state.isActive && state.currentLine !== null) {
    const modified = this.shaderDebugManager.modifyShaderForDebugging(sourceCode, state.currentLine);
    if (modified) {
      return { code: modified, config: debugConfig };
    }
  }

  // Post-processing applies to the active source (buffer or Image)
  if (state.isEnabled) {
    const postProcessed = this.shaderDebugManager.applyFullShaderPostProcessing(sourceCode);
    if (postProcessed) return { code: postProcessed, config: debugConfig };
  }

  return { code: originalCode, config };
}

private withBufferInputsAsImage(
  config: ShaderConfig | null,
  bufferName: string,
): ShaderConfig | null {
  if (!config || bufferName === 'Image' || bufferName === 'common') return config;
  const bufferPass = config.passes[bufferName];
  if (!bufferPass || !('inputs' in bufferPass)) return config;
  return {
    ...config,
    passes: {
      ...config.passes,
      Image: { ...config.passes.Image, inputs: bufferPass.inputs },
    },
  };
}
```

Update `processMainShaderCompilation()`:
```typescript
const { code: codeToCompile, config: configToCompile } = this.getDebugCompileArgs(code, config);
const result = await this.renderEngine.compileShaderPipeline(
  codeToCompile, configToCompile, path, buffers, ...
);
```

`debugCompile()` gets the same treatment. The stored `config` comes from `this.lastEvent.data` which already has it.

---

### Step 6 — VariableCaptureManager: active buffer code + input bindings

**Files**: `ui/src/lib/VariableCaptureManager.ts`, `rendering/src/capture/VariableCapturer.ts` (or equivalent)

**6a — Pass active buffer code and inputConfig via `CaptureParams`**

Add `inputConfig` to `CaptureParams`:

```typescript
interface CaptureParams {
  code: string;
  inputConfig?: Record<string, ConfigInput>; // buffer's own inputs
  // ...existing fields...
}
```

In `ShaderViewer.svelte`'s `notifyVariableCaptureManager()`, populate `code` with `shaderDebugManager.getActiveCode(currentShaderCode)` and `inputConfig` from `currentConfig`:

```typescript
const activeBuffer = debugState.activeBufferName;
const bufferPass = activeBuffer !== 'Image' ? currentConfig?.passes[activeBuffer] : undefined;
const inputConfig = bufferPass && 'inputs' in bufferPass ? bufferPass.inputs : undefined;
variableCaptureManager.notifyStateChange({
  code: shaderDebugManager.getActiveCode(currentShaderCode),
  inputConfig,
  // ...existing fields unchanged...
});
```

`ShaderViewer` already stores `currentConfig` (set at line 575 from `event.data.config`). `ShaderDebugManager.getActiveCode(imageCode)` returns buffer code when a buffer is active, Image code otherwise.

In `issueCaptures()`, the two `VariableCaptureBuilder` calls already use `params.code` which now contains the buffer's code — no change needed there.

**6b — Bind input textures when running capture shaders**

Currently `issueCaptureGrid` / `issueCaptureAtPixel` only receive standard uniforms — no texture bindings. Extend the capturer to also bind iChannel textures:

```typescript
// VariableCaptureManager.issueCaptures — before issuing:
if (params.inputConfig) {
  this.capturer.setInputBindings(params.inputConfig);
}
```

`VariableCapturer.setInputBindings(inputConfig)` resolves the input config against the rendering engine's live resources (the same `passBuffers` and texture handles that `PassRenderer.getTextureBindings` uses) and binds them to texture units when each capture shader runs.

---

### Step 7 — DebugPanel UI: buffer indicator

**File**: `ui/src/lib/components/debug/DebugPanel.svelte`

In the debug panel header, add a buffer badge when `state.activeBufferName !== 'Image'` and debug is enabled:

```svelte
{#if state.isEnabled && state.activeBufferName && state.activeBufferName !== 'Image'}
  <span class="buffer-badge">{state.activeBufferName}</span>
{/if}
```

Style it as a subtle pill next to the "Debug" heading. No dropdown needed — `common` debugging just works via the helper-function path in the transpiler, no context selection required.

---

## What This Covers

| Scenario | Works? | Notes |
|---|---|---|
| Cursor in `BufferA.glsl`, line inside `mainImage` | ✅ | Identical to Image pass debugging |
| Cursor in `BufferA.glsl`, line inside a helper function | ✅ | Helper function wrapping path |
| Cursor in `common.glsl`, line inside a utility function | ✅ | Helper function wrapping path generates mainImage wrapper. Common is pure function/constant definitions — no iChannel reads, no inputs config needed |
| Variable inspector on buffer/common line | ✅ | Capture uses active buffer code and binds its iChannel inputs |
| Function parameters panel for buffer functions | ✅ | `updateFunctionContext` uses active buffer code |
| Buffer reads from `iChannel` (textures, other buffers) | ✅ | Buffer's own `inputs` config replaces Image pass config — all channels bind correctly |
| Post-processing (normalize/step) on buffer | ✅ | Applied to active source code, not hardcoded to Image |
| Feedback buffers (self-referencing iChannel) | ⚠️ | Buffer state is maintained (buffer still runs every frame with original code). Subtle: the debug Image reads BufferA's `front` after it has been swapped (current-frame output), while BufferA itself reads `front` before the swap (previous-frame output). One frame ahead for self-feedback patterns only. Non-feedback variables and variables computed before the texture read are unaffected. |

---

## Files Modified

| File | Change |
|---|---|
| `ui/src/lib/types/ShaderDebugState.ts` | Add `activeBufferName: string` |
| `ui/src/lib/ShaderDebugManager.ts` | `setShaderContext()`, `resolveActiveBuffer()`, `getActiveCode()`, update `updateDebugLine()` and `updateFunctionContext()` |
| `ui/src/lib/util/BufferUpdater.ts` | Make `bufferFileExistsInCurrentShader()` and `getBufferNameForFilePath()` public (reused from MessageHandler) |
| `ui/src/lib/transport/MessageHandler.ts` | Relax cursor lock filter (use `bufferUpdater.bufferFileExistsInCurrentShader`), call `setShaderContext()` |
| `ui/src/lib/ShaderProcessor.ts` | `getDebugCompileArgs()` replaces `getDebugCodeToCompile()`, `withBufferInputsAsImage()` |
| `ui/src/lib/VariableCaptureManager.ts` | Add `inputConfig` to `CaptureParams`; pass active buffer code and inputs |
| `rendering/src/capture/VariableCapturer.ts` | `setInputBindings()` — bind iChannel textures when running capture shaders |
| `ui/src/lib/components/ShaderViewer.svelte` | Update `notifyVariableCaptureManager()` to pass active buffer code and `inputConfig` |
| `ui/src/lib/components/debug/DebugPanel.svelte` | Buffer badge in header |

---

## Known Limitations

- **Self-feedback iChannel (ping-pong)**: When debugging BufferA, the debug Image reads from BufferA's `front` after it has already rendered and swapped — so it sees the current-frame output, whereas BufferA itself reads `front` before the swap (previous-frame output). One frame ahead for self-feedback patterns only. In practice imperceptible (a `mix(prev, new, 0.01)`-style accumulation is indistinguishable one frame off). Fixing it precisely would require snapshotting each buffer's `front` before it renders every frame — extra FBO allocation and blit overhead not worth the cost.

---

## Implementation Order: Tests First

All test files are written. 80 tests total: 60 failing (red — unimplemented APIs), 20 passing (boundary cases and fallbacks that existing code already satisfies — these act as regression guards). Each failing test becomes green once the corresponding implementation step is done.

### `ui/src/test/debug/ShaderDebugManager.bufferDebugging.test.ts`
Covers Steps 2/3.
- `setShaderContext` stores config, path, and buffer codes; handles null config; overwrites on re-call
- `resolveActiveBuffer` (via `updateDebugLine`) maps Image path → Image, buffer paths → buffer names, common → common, unknown → Image fallback, path suffix matching, default before context is set
- `getActiveCode` returns imageCode for Image, buffer code for buffers, fallback when code missing, updates after re-setShaderContext
- `updateFunctionContext` extracts context from buffer code when buffer active, from Image code when Image active, from common code when common active; clears custom params on function switch across files
- Line lock respects buffer file paths

### `ui/src/test/transport/MessageHandler.bufferCursor.test.ts`
Covers Steps 1 and 4.
- `setShaderContext` called on every shader message with correct args; handles missing config/buffers
- Cursor from buffer file accepted when locked; cursor from unrelated file rejected; cursor from common accepted
- Inline cursor in shader message accepted for buffer files when locked
- Debug recompile triggered when cursor moves to buffer line

### `ui/src/test/ShaderProcessor.bufferDebug.test.ts`
Covers Step 5.
- Buffer code (not Image code) used as transpiler source when buffer active
- Modified buffer code passed as Image `code` arg to `compileShaderPipeline`
- Buffer inputs replace Image inputs in config; original config not mutated
- Correct buffer inputs used for BufferB
- Fallbacks when buffer code missing or transpiler returns null
- Common file: uses common code, does not replace Image inputs
- Post-processing applied to buffer code; uses buffer input config
- `debugCompile` uses buffer code when buffer active

### `ui/src/test/VariableCaptureManager.bufferCapture.test.ts`
Covers Step 6.
- `setInputBindings` called when `inputConfig` present; not called when absent
- `setInputBindings` called before capture is issued; called with correct object
- Updated `inputConfig` used on subsequent calls
- `getVariableCaptureCompileContext` called with buffer code from `params.code`
- Backwards compatible — Image pass debugging unchanged

### `ui/src/test/components/debug/DebugPanel.bufferBadge.test.ts`
Covers Step 7.
- Badge not rendered for Image; rendered for BufferA, BufferB, common
- Badge shows correct buffer name; updates reactively on state change
- Badge not shown when debug is disabled
