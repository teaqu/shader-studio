# AGENTS.md

Guide for AI agents working on this codebase.

## Project Structure

Monorepo with Turborepo. Key packages:

- `ui/` — Svelte 5 frontend (shader viewer, editor, config panels)
- `types/` — Shared TypeScript types (`@shader-studio/types`)
- `rendering/` — WebGL pipeline logic
- `extension/` — VS Code extension host
- `electron/` — Electron shell
- `glsl-debug/` — GLSL debug tooling

Most frontend work happens in `ui/src/lib/`.

## Frontend Architecture

### Svelte 5 Runes

New components use Svelte 5 runes. Key conventions:

- Reactive state: `let x = $state(value)` (not `let x = value` with `$:`)
- Derived state: `const x = $derived(expr)` or `$derived.by(() => { ... })`
- Side effects: `$effect(() => { ... })` (not `$: { }` blocks)
- Props: `let { prop1, prop2 }: Props = $props()` (not `export let`)
- Opt in per-component: `<svelte:options runes={true} />`
- Runes in `.ts` files: use `.svelte.ts` extension (e.g. `ResolutionSessionController.svelte.ts`)

Old components not yet migrated still use Svelte 4 style (`export let`, `$:`, stores). Do not mix runes and legacy reactive syntax in one component.

### Controller Pattern

Complex stateful logic extracted into controller classes (not inline in `.svelte` files).

Pattern:
1. **Pure state module** (`*State.ts`) — plain TypeScript, no Svelte imports. Pure functions operating on plain state objects.
2. **Controller** (`*.svelte.ts`) — uses `$state` rune for reactive state. Receives a `deps` object for all external reads/writes.

Example: `ui/src/lib/resolution/`
- `ResolutionSessionState.ts` — pure functions, no Svelte
- `ResolutionSessionController.svelte.ts` — stateful controller with `$state`

### Dependency Injection via Deps Object

Controllers take a `deps: ControllerDeps` interface instead of direct references. This enables:
- Fine-grained Svelte 5 reactivity (getter props track `$state` reads)
- Easy mocking in tests
- No prop-drilling or circular imports

**Critical pattern**: use getter properties for reactive values so Svelte's signal tracker sees through them:

```ts
const ctrl = new ResolutionSessionController({
  get currentConfig() { return currentConfig; },  // $state variable — getter enables reactivity
  get debugState() { return debugState; },
  setCurrentConfig: (c) => { currentConfig = c; },
  updatePipelineConfig: (c) => pipeline?.updateCurrentConfig(c),
  recompileCurrentShader: () => {
    pipeline?.recompileCurrentShader?.();          // ?.() guards undefined method
  },
  // ...
});
```

Do NOT use regular properties for reactive values — they capture the value at construction time, not live.

### Svelte Context for Dependency Injection

Controllers shared between parent and child components use Svelte context (not prop drilling):

```ts
// Parent (ShaderViewer.svelte)
setContext('resolution', resolutionController);

// Child (MenuBar.svelte)
const resCtrl = getContext<ResolutionSessionController>('resolution');
```

`setContext` must be called synchronously during component initialization (not inside `onMount`). Controller must be created before any child component that calls `getContext`.

## Resolution Module

`ui/src/lib/resolution/` handles all resolution/aspect-ratio state.

Key concepts:
- `syncWithConfig` — when true, edits write through to shader config file; when false, session-local override
- `ResolutionTarget` — either `{ kind: 'image' }` or `{ kind: 'buffer', bufferName: string }`
- Target determined by debug state (buffer inline rendering changes active target)
- `ResolutionMenuViewModel` — flat view model consumed by MenuBar UI

Controller entry points:
- `handleShaderLoaded(config, isSameShader)` — call on shader load
- `handleConfigUpdated(config)` — call when config changes externally
- `handleDebugStateChanged()` — call when inline render target changes
- `setSyncWithConfig(enabled)` — toggle sync mode
- `setAspectRatio/setImageScale/setImageCustomResolution` — image resolution setters
- `setBufferResolutionMode/setBufferFixedResolution/setBufferScale` — buffer resolution setters
- `resetCurrentTarget()` — reset current target's resolution to default

## Testing

Framework: Vitest + `@testing-library/svelte`.

Run tests:
```sh
cd ui && npx vitest run
```

Test structure mirrors `src/lib/`: unit tests for controllers/managers in `src/test/`, component tests in `src/test/components/`.

### Mocking Controllers in Component Tests

Components that use `getContext` need context injected in tests:

```ts
function createMockResCtrl(): ResolutionSessionController {
  return {
    menuVM: { syncWithConfig: true, targetKind: 'image', /* ... */ },
    setSyncWithConfig: vi.fn(),
    setAspectRatio: vi.fn(),
    // ...
  } as unknown as ResolutionSessionController;
}

render(MenuBar, {
  props: defaultProps,
  context: new Map([['resolution', createMockResCtrl()]]),
});
```

### Controller Unit Tests

Test pure state functions directly (`ResolutionSessionState.ts`) without needing Svelte. For controller tests, pass a mock deps object.

## Key Files

| File | Purpose |
|------|---------|
| `ui/src/lib/components/ShaderViewer.svelte` | Root component, creates all controllers, sets context |
| `ui/src/lib/components/MenuBar.svelte` | Top menu bar, reads resolution state from context |
| `ui/src/lib/resolution/ResolutionSessionController.svelte.ts` | Resolution state controller |
| `ui/src/lib/resolution/ResolutionSessionState.ts` | Pure resolution state functions |
| `ui/src/lib/ShaderPipeline.ts` | WebGL pipeline, compile/render |
| `ui/src/lib/ShaderDebugManager.ts` | Debug/inline render state |
| `ui/src/lib/stores/resolutionStore.ts` | Svelte store for canvas resolution |
| `ui/src/lib/stores/aspectRatioStore.ts` | Svelte store for aspect ratio mode |

## Conventions

- Optional method calls: `obj?.method?.()` not `typeof obj.method === 'function' && obj.method()`
- No `any` without comment explaining why
- Prefer pure functions over methods with side effects where possible
- ESLint enforced — run `npx eslint --fix` before committing
- All new `.ts` files with runes must use `.svelte.ts` extension
