# Shader Studio Slang Roadmap

**Date:** 2026-07-19

**Status:** Directional roadmap

## Purpose

Track the major Slang capabilities Shader Studio may add after the workspace foundation. Each phase is independently designed, approved, planned, implemented, and verified. Later phases are not commitments to turn Shader Studio into a general-purpose GPU runtime; their priority depends on user value and the product's continued focus on visual shader authoring and debugging.

## Phase 1: Workspace Foundation

Detailed in `2026-07-19-slang-foundation-design.md`.

Deliverables:

- Explicit, non-breaking Slang language-version policy.
- Shared WASM workspace/language-service adapter.
- Native `import`, `__include`, and `#include` resolution.
- Consistent VS Code and Monaco language features.
- Dependency-aware hot reload and correct cross-file diagnostics.
- Debugger regression coverage.
- Manual multipass workspace fixtures.

Exit condition: Shader Studio understands a Slang workspace rather than treating every `.slang` file as an isolated `mainImage` source.

## Phase 2: Reflection-Driven Parameters and Resources

Goal: move beyond a fully hard-coded WebGPU binding layout while preserving the simple ShaderToy mode.

Candidate deliverables:

- Expose program layout reflection through the shared WASM adapter.
- Discover global parameters, offsets, resource kinds, and binding locations.
- Generate WebGPU bind-group layouts from reflected data.
- Support user-declared constant buffers, textures, samplers, storage buffers, and storage textures within an explicit support matrix.
- Support Slang `ParameterBlock<>` values.
- Define deterministic ownership between generated ShaderToy resources and reflected user resources.
- Diagnose binding collisions and unsupported target layouts before WebGPU pipeline creation.
- Add UI controls or config bindings only for reflected values that Shader Studio can safely edit.

Design questions to resolve:

- Whether manual `register(...)` and `[[vk::binding(...)]]` annotations are supported or rejected.
- How reflected resources are associated with `.sha.json` paths and scripts.
- How parameter-block lifetimes map onto Image and buffer passes.
- Whether layouts remain stable across specialization and hot reload.

Exit condition: useful user-declared Slang resources can be bound without adding a bespoke generated declaration for every resource.

## Phase 3: Broader Slang Debugging

Goal: make visual debugging understand the language constructs encouraged by a modular Slang workspace.

Candidate deliverables:

- Scoped identifiers, namespaces, and module-qualified definitions.
- Struct member access and member methods.
- Interfaces, generic functions, and concrete specializations.
- Debug navigation and variable capture across imported modules.
- More complete Slang type parsing.
- Attribute-aware function discovery.
- Explicit diagnostics for constructs that cannot be safely instrumented.
- A decision on replacing or augmenting the current custom parser with compiler-derived syntax/reflection information.

This phase may overlap incrementally with Phase 2, but every debugger feature must follow the production syntax/resource behavior it instruments.

Exit condition: supported modular and generic Slang code can be inspected without flattening it manually into `mainImage`.

## Phase 4: Native Pipeline Entry Points

Goal: allow advanced users to opt out of generated graphics entry points while retaining `mainImage` as the default authoring mode.

Candidate deliverables:

- Configurable vertex and fragment entry-point names.
- Reflection-driven vertex input layouts.
- Configurable render-target formats and multiple fragment outputs.
- Explicit pipeline mode in `.sha.json` so native and ShaderToy contracts cannot be confused.
- Compute shader entry points and dispatch configuration.
- Buffer and texture result visualization for compute passes.
- Clear capability and WebGPU target diagnostics.

Dependencies:

- Reflection-driven resource layouts from Phase 2.
- Adequate editor and diagnostic foundations from Phase 1.
- Debugging support designed separately for each new pipeline kind.

Exit condition: Shader Studio can run a deliberately configured native Slang graphics or compute pipeline without weakening the simple preview workflow.

## Phase 5: Advanced and Research Features

Candidates are evaluated independently rather than bundled into one release:

- Link-time specialization controls.
- Precompiled module and persistent compilation caches.
- Automatic differentiation authoring and visualization workflows.
- Storage-buffer inspection and structured data visualization.
- Compute-result plotting and image/buffer explorers.
- Ray-tracing feasibility on available web/runtime targets.
- Shader capability/profile inspection.
- Reassessment of `.hlsl` compatibility after native resources and entry points exist.

Each candidate needs a product use case, target-support audit, small technical spike, explicit debugger story, and independent go/no-go decision.

## Deferred HLSL Position

`.hlsl` support is intentionally deferred. Slang already provides an HLSL-derived authoring language, while an `.hlsl` extension would imply a DXC compatibility promise that Shader Studio cannot currently meet.

Reconsider HLSL when:

- Existing HLSL asset import is a demonstrated user need.
- Reflection-driven resource bindings exist.
- Native entry-point configuration exists.
- Includes and workspace dependency handling are mature.
- A compatibility corpus can define the accepted HLSL subset.

Until then, `.slang` remains the accurate WebGPU authoring surface.

## Ordering and Parallelism

Phase 1 is foundational and precedes every later phase. Phase 2 resource reflection and selected Phase 3 parser/debugger investigations may overlap after their shared reflection contracts are fixed. Phase 4 depends on Phase 2. Phase 5 candidates can be researched in parallel but must not enter implementation without separate approved designs.

The roadmap is reviewed after each phase. Completed work, user feedback, compiler changes, and WebGPU platform support may reorder or remove later items.
