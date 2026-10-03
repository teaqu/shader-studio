import type { WgslTraceLaunch } from '@shader-studio/types';

// Every refusal is pinned to a fixture and a narrow diagnostic. New files and
// unexpected failures must be reviewed; a blanket catch would hide regressions.
export const supportedTraceSources = new Set([
  'wgsl/cat-head.wgsl',
  'wgsl/custom-uniforms.wgsl',
  'wgsl/foundation/debugging/passes/history-source.wgsl',
  'wgsl/fullscreen-vertex.wgsl',
  'wgsl/parity/pass-timing/a.wgsl',
  'wgsl/parity/pixel-inspector/gradient.wgsl',
  'wgsl/plane.wgsl',
  'wgsl/shadertoy.wgsl',
  'wgsl/shadertoy2.wgsl',
  'wgsl/test.wgsl',
  'wgsl/vertex.wgsl',
  'wgsl/visor.wgsl',
]);

export const traceLaunchInputs: Record<string, Pick<WgslTraceLaunch, 'customUniforms'>> = {
  'wgsl/custom-uniforms.wgsl': { customUniforms: [
    { name: 'uRed', type: 'float', value: 0.5 }, { name: 'uGreen', type: 'float', value: 1 },
    { name: 'uOffset', type: 'float', value: 0 },
  ] },
};

const exclusions: Array<{ diagnostic: RegExp; files: string[] }> = [
  { diagnostic: /^WGSL trace compilation failed: unresolved call target 'iChannel0Sample'$/, files: [
    'wgsl/33channels.wgsl',
    'wgsl/backend-differences/precision/history.wgsl',
    'wgsl/backend-differences/precision/precision.wgsl',
    'wgsl/buffers/buffer_a.wgsl',
    'wgsl/buffers/buffer_b.wgsl',
    'wgsl/cat-body.wgsl',
    'wgsl/compute-lab/channel-cover.wgsl',
    'wgsl/compute-lab/dispatch-modes.wgsl',
    'wgsl/compute-lab/game-of-life.wgsl',
    'wgsl/compute-lab/layered-output.wgsl',
    'wgsl/compute-lab/raw-workgroups.wgsl',
    'wgsl/compute-lab/system-values.wgsl',
    'wgsl/compute-lab/workgroup-coverage.wgsl',
    'wgsl/cubemap.wgsl',
    'wgsl/foundation/debugging/debug-coverage.wgsl',
    'wgsl/foundation/debugging/passes/history.wgsl',
    'wgsl/foundation/workspace/foundation.wgsl',
    'wgsl/foundation/workspace/passes/history.wgsl',
    'wgsl/gravity/gravity.wgsl',
    'wgsl/intellisense_compute.wgsl',
    'wgsl/intellisense.wgsl',
    'wgsl/keyboard.wgsl',
    'wgsl/parity/pass-timing/b.wgsl',
    'wgsl/parity/pass-timing/timing.wgsl',
    'wgsl/parity/reset-feedback/history.wgsl',
    'wgsl/parity/reset-feedback/reset.wgsl',
    'wgsl/parity/resize-feedback/history.wgsl',
    'wgsl/parity/resize-feedback/resize.wgsl',
    'wgsl/particles.wgsl',
    'wgsl/structs/structs.wgsl',
    'wgsl/texture.wgsl',
    'wgsl/two-meshes.wgsl',
    'wgsl/video_audio.wgsl',
    'wgsl/video.wgsl',
  ] },
  { diagnostic: /^The trace PoC requires fn mainImage\(coord: vec2f\) -> vec4f\.$/, files: [
    'wgsl/common.wgsl',
    'wgsl/feature-coverage.common.wgsl',
    'wgsl/feature-coverage.vert.wgsl',
    'wgsl/foundation/debugging/common.wgsl',
    'wgsl/foundation/workspace/common.wgsl',
    'wgsl/fullscreen-vertex.vert.wgsl',
    'wgsl/gravity/common.wgsl',
    'wgsl/intellisense.vert.wgsl',
    'wgsl/plane.vert.wgsl',
    'wgsl/structs/common.wgsl',
    'wgsl/vertex_vertex.wgsl',
    'wgsl/visor.vertex.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved value 'samples'$/, files: [
    'wgsl/compute-lab/count-dispatch.wgsl',
    'wgsl/compute-lab/multi-entry.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved value 'seed'$/, files: [
    'wgsl/compute-lab/one-shot-storage.wgsl',
  ] },
  { diagnostic: /^The trace PoC requires a mainImage shader without authored GPU bindings\/entry points or reserved _ss_trace_ names\.$/, files: [
    'wgsl/compute-lab/passes/channel-covered.wgsl',
    'wgsl/compute-lab/passes/channel-source.wgsl',
    'wgsl/compute-lab/passes/count-gradient.wgsl',
    'wgsl/compute-lab/passes/dispatch-modes-kernels.wgsl',
    'wgsl/compute-lab/passes/game-of-life.wgsl',
    'wgsl/compute-lab/passes/intellisense-compute.wgsl',
    'wgsl/compute-lab/passes/layered-output.wgsl',
    'wgsl/compute-lab/passes/multi-entry-kernels.wgsl',
    'wgsl/compute-lab/passes/one-shot-init.wgsl',
    'wgsl/compute-lab/passes/raw-workgroups.wgsl',
    'wgsl/compute-lab/passes/substep-init.wgsl',
    'wgsl/compute-lab/passes/substep.wgsl',
    'wgsl/compute-lab/passes/system-values.wgsl',
    'wgsl/compute-lab/passes/workgroup-coverage.wgsl',
    'wgsl/gravity/init.wgsl',
    'wgsl/gravity/present.wgsl',
    'wgsl/gravity/sim.wgsl',
    'wgsl/init.wgsl',
    'wgsl/present.wgsl',
    'wgsl/shadertoy2.computea.wgsl',
    'wgsl/structs/init.wgsl',
    'wgsl/structs/present.wgsl',
    'wgsl/vertex_init.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved value 'laneA'$/, files: [
    'wgsl/compute-lab/repeated-substeps.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved value 'colours'$/, files: [
    'wgsl/compute-lab/storage-edit-colours.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved call target 'patternTexSample'$/, files: [
    'wgsl/feature-coverage.buffer.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved value 'uFloat'$/, files: [
    'wgsl/feature-coverage.wgsl',
    'wgsl/uniforms.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved call target 'palette'$/, files: [
    'wgsl/flow.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved call target 'foundationBlurHistory'$/, files: [
    'wgsl/foundation/workspace/passes/glow.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved call target 'iChannel2Sample'$/, files: [
    'wgsl/ich.wgsl',
  ] },
  { diagnostic: /^WGSL trace compilation failed: unresolved call target 'albedoSample'$/, files: [
    'wgsl/parity/channels/named.wgsl',
  ] },
];

export const expectedTraceRefusals = new Map(exclusions.flatMap(group =>
  group.files.map(file => [file, group.diagnostic] as const)));
