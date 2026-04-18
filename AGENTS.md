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

## Testing

Framework: Vitest + `@testing-library/svelte`.

Run tests:
```sh
cd ui && npx vitest run
```

**Every change must have unit tests. Aim for excellent coverage — all branches, edge cases, and error paths covered.** When reviewing or making changes, audit test coverage and add missing tests before considering work done.

Test structure mirrors `src/lib/`: unit tests in `src/test/`, component tests in `src/test/components/`.

## Linting

ESLint is enforced. **Always run ESLint after making changes:**

```sh
npx eslint --fix
```

Do not commit code with lint errors.

Always prefer Svelte 5 conventions over Svelte 4. For example: runes over stores, `$state`/`$derived`/`$effect` over `$:` reactivity, module-level `.svelte.ts` state or context over prop drilling.

## Conventions

- Optional method calls: `obj?.method?.()` not `typeof obj.method === 'function' && obj.method()`
- No `any` without comment explaining why
- Prefer pure functions over methods with side effects where possible
- All new `.ts` files with runes must use `.svelte.ts` extension
- Always define props with an `interface Props` and `let { ... }: Props = $props()`
