# Slang → WebGPU spike

Day-1 throwaway harness answering: **can we read a `.slang` file, compile it to
WGSL in-browser, and render it via WebGPU?** — the gating question before
committing to a separate Slang/WebGPU pipeline (Option B).

## What it proves

1. `navigator.gpu` is available in the target runtime (badge at top).
2. `slang-wasm` loads and reports its version.
3. A `.slang` file is read from disk and compiled to WGSL (shown in the panel).
4. The WGSL drives a WebGPU render pipeline — an animated gradient on the canvas.

Each stage logs pass/fail, so a failure pinpoints the broken stage.

## Run

```sh
cd spike/slang-webgpu
node serve.mjs
# open http://localhost:8099/
```

Headless compile check (no browser, stages 1–3 only):

```sh
node check.mjs
```

## Files

- `shader.slang` — minimal Slang (vertex + fragment + a `time` uniform)
- `main.js` — loader, Slang→WGSL compile, WebGPU pipeline + render loop
- `serve.mjs` — zero-dep static server (correct wasm MIME, COOP/COEP)
- `vendor/` — `slang-wasm.js` / `.wasm` (the `.wasm` is gitignored; see below)

## Re-fetching slang-wasm

The `.wasm` (~21MB) is not committed. To restore:

```sh
curl -sL https://github.com/shader-slang/slang/releases/download/v2026.10.2/slang-2026.10.2-wasm.zip -o vendor/slang-wasm.zip
# then extract slang-wasm.js + slang-wasm.wasm + interface.d.ts into vendor/
```

## Next step after this proves out

Verify the same page loads inside a **VS Code webview** (the real deployment
target) — that's the remaining unknown for Option B in the extension.
