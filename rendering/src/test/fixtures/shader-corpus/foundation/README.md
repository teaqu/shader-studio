# Slang workspace foundation acceptance fixture

This additive fixture exercises Shader Studio's Phase 1 Slang workspace support. Open
`/Users/calum/Projects/slang-multipass-test` as the VS Code workspace, then preview the
listed root `.slang` files. Do not add a language version to any `.sha.json`: source
headers are authoritative.

## Expected previews

| Root | Expected result |
| --- | --- |
| `versions/legacy/preview.slang` | Dark red field with a bright red top-left quadrant. The file has no directive and must use Shader Studio's explicit legacy fallback. |
| `versions/slang-2025/preview.slang` | Dark green field with a bright green top-right quadrant; the source selects `slang 2025`. |
| `versions/slang-2026/preview.slang` | Dark blue field with a bright blue bottom-left quadrant; the source selects `slang 2026`. |
| `versions/latest/preview.slang` | Dark amber field with a bright amber bottom-right quadrant; `latest` is used only because the source explicitly asks for it. |
| `modules/import-preview.slang` | Animated magenta bands. Changing `kFoundationPaletteAccent` in `modules/palette.slang` visibly changes the preview. |
| `includes/include-preview.slang` | Animated HDR gradient. Changing `kFoundationExposure` in `includes/tone-map.slang` visibly changes the preview. |
| `workspace/foundation.slang` | Moving feedback trails from History (`BufferA`) with half-resolution Glow (`BufferB`). Red is at the top edge and green at the left edge. Mouse painting appears under the pointer and drifts downward. |
| `debugging/debug-coverage.slang` | Animated orange/blue feedback blended with moving palette bands. Clicking paints cyan into the feedback buffer. This fixture is the manual acceptance target for root, buffer, common, direct-import, and transitive-import debugging. |
| `debugging/debug-coverage_glsl.glsl` | GLSL visual/debugging twin of `debug-coverage.slang`. Imported helpers are flattened into their consuming passes; use it for root, buffer, common, loop, local, return-value, preview, capture, and unlocked no-`mainImage` navigation comparisons. |

## Acceptance matrix

Use the normal VS Code editor. Language-server navigation, Monaco language features,
and new-file templates are intentionally outside this runtime-workspace fixture. For
dependency edits, keep the root preview open.

| Area | Action | Expected result |
| --- | --- | --- |
| Language mode | Open all four `versions/**/preview.slang` roots. | Each shows its documented quadrant. Legacy is selected only for the directive-free source; explicit 2025, 2026, and latest remain exact. No JSON setting overrides the source. |
| Unsaved import edit | Without saving, change `kFoundationPaletteAccent` in `modules/palette.slang`. | `import-preview.slang` recompiles from the unsaved buffer and changes color. No unrelated root recompiles. Undo restores the original magenta. |
| Disk import edit | Save a change to `kFoundationWarm` in `workspace/lib/palette.slang`. | Image, History (`BufferA`), and Glow (`BufferB`) invalidate because all import the module; unrelated isolated previews do not. The combined image changes, and a single save does not cause a second duplicate compile after the hot update. |
| Unsaved include edit | Without saving, change `kFoundationExposure` in `includes/tone-map.slang`. | Only `include-preview.slang` recompiles and changes brightness. Undo immediately restores it. |
| Selective include invalidation | Change `kFoundationBlurRadius` in `workspace/include/blur.slang`. | Only Glow (`BufferB`) and its downstream Image result update; History (`BufferA`) is not directly recompiled. Changing `workspace/include/tone-map.slang` recompiles Image and History, not Glow. |
| Dependency error | Introduce a syntax error in `modules/palette.slang`, an include, and then a workspace dependency. | The diagnostic URI names the dependency file (not merely the root), the range highlights the offending dependency text, and the diagnostic identifies every affected pass/root. Unaffected roots remain live. |
| Error recovery | With a dependency error visible, undo it, then repeat by saving an error and fixing it on disk. | Diagnostics clear after each fix. The last-good frame remains visible while compilation is broken; rendering resumes without closing the preview. |
| Save deduplication | Make an unsaved dependency edit that recompiles successfully, then save without changing it. | The save/watch event is deduplicated: no redundant second compile or flicker occurs. |
| Close/reopen | Edit a dependency unsaved, close it and discard, then reopen it; repeat while saving. | Discard returns the preview to disk content and clears stale diagnostics. Saved content survives close/reopen and the dependency graph remains connected. |
| Resize | Resize the preview repeatedly while `workspace/foundation.slang` is running. | Feedback targets resize cleanly, keep moving, and preserve correct top/left orientation without WebGPU validation errors. |
| Half resolution | Inspect or temporarily exaggerate Glow in `workspace/foundation.slang`. | Glow (`BufferB`) visibly comes from the `resolution.scale: 0.5` pass; its shader's `iResolution` is the half-size target. History (`BufferA`) remains full size. |
| Feedback | Run the workspace without interaction, then paint with the mouse. | The automatic emitter moves continuously. Paint lands beneath the cursor and trails drift downward, proving self-feedback and orientation. |
| Last-good capture | Start line debug/variable capture on a supported root or textual include, then introduce a dependency compile error. | The last-good render/capture stays available and the structured compile diagnostic points to the dependency. Fixing the error resumes capture. |
| Debug root | Debug/capture an expression in `foundation.slang`, `history.slang`, or `glow.slang`. | Root instrumentation compiles with the same workspace snapshot and produces the expected value without changing header line positions. |
| Debug include | Debug/capture a supported expression originating from a textual include. | The include inherits its root's language mode and produces the correct capture while preserving source identity and line mapping; it must never instrument the wrong file. |
| Debug imported/common | With `debugging/debug-coverage.slang` previewing, inspect expressions in `debugging/common.slang`, `debugpalette.slang`, `debugmath.slang`, and `passes/debugfeedback.slang`. | The selected source is instrumented in its owning pass, its locals and return values are available, and diagnostics retain the dependency file path. The preview remains live after capture. |
| Root capture and recording | Capture a screenshot, GIF, and video from `workspace/foundation.slang`. | Each output uses the active workspace-backed multipass render and completes without losing the feedback buffers. |
| Dependency capture | Capture `blend` or `color` in `debugpalette.slang`, `harmonic` or `result` in transitive dependency `debugmath.slang`, and `modulation` or `decayed` in BufferA dependency `debugfeedback.slang`. | Direct and transitive imports compile from the same dependency snapshot, loop-local captures resolve at the selected pixel, and the owning Image/BufferA pass is used. |
| Common capture | Capture `radiusSquared`, `vignette`, `exposure`, or `mapped` in `debugging/common.slang`. | Configured common code is instrumented without losing either pass context. Capturing from Image and BufferA produces values appropriate to that pass. |
| Debug error recovery | While capturing an imported expression, introduce a syntax error or rename one of its imports, then undo it. | A structured diagnostic names the missing/broken dependency and its importer. The last-good render remains visible, and capture resumes after undo. |

## Useful dependency edits

- `modules/palette.slang`: change `kFoundationPaletteAccent` from magenta to cyan.
- `includes/tone-map.slang`: change `kFoundationExposure` from `1.35` to `0.45`.
- `workspace/lib/palette.slang`: swap `kFoundationWarm` and `kFoundationCool`.
- `workspace/include/blur.slang`: change `kFoundationBlurRadius` from `2` to `1`.
- `workspace/include/tone-map.slang`: change `kWorkspaceExposure` from `1.15` to `0.7`.
- `debugging/debugpalette.slang`: swap `coolColor` and `warmColor` while the root preview is open; the unsaved edit should update immediately.
- `debugging/debugmath.slang`: change the loop bound from `4` to `2` to test transitive-import invalidation and capture recovery.
- `debugging/passes/debugfeedback.slang`: change `modulation` from `0.97` to `0.9` to make BufferA feedback decay faster.

Restore each value after its acceptance check so later checks begin from the documented
visual baseline.
