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

**Also run `npx svelte-check` after making changes to `.svelte` files.** Fix all errors and warnings it reports — including Svelte-specific diagnostics like non-reactive updates (`$state` missing), unused props, and type errors that `tsc` alone won't catch.

Always prefer Svelte 5 conventions over Svelte 4. For example: runes over stores, `$state`/`$derived`/`$effect` over `$:` reactivity, module-level `.svelte.ts` state or context over prop drilling.

## Conventions

- Optional method calls: `obj?.method?.()` not `typeof obj.method === 'function' && obj.method()`
- No `any` without comment explaining why
- Prefer pure functions over methods with side effects where possible
- All new `.ts` files with runes must use `.svelte.ts` extension
- Always define props with an `interface Props` and `let { ... }: Props = $props()`
- Prefer reactive state over callbacks for **state propagation**: use `$derived` or `$effect` reading module-level `$state` rather than threading values down through props.
- Do not build callback chains for shared UI state such as hover previews, active selections, transient inspector state, or cross-panel coordination. From the first implementation, put that state in `ui/src/lib/state/` as a `.svelte.ts` rune module and have producers call exported setters while consumers read exported getters in `$derived`/`$effect`.
- Use callback props for direct commands/events only, such as button clicks that invoke an owner action. If the callback only exists to move state through intermediate components, replace it with shared rune state.
- Shared UI state lives in `ui/src/lib/state/` as `.svelte.ts` files exporting getter/setter functions over module-level `$state`. No writable stores, no `subscribe`.
- **Effects belong in the class that owns the behavior**, not in the consumer. If a manager class needs to react to state changes, give it a `$effect.root()` in its constructor and clean up in `dispose()`. Don't push reactive glue into components that shouldn't need to know about it.
- When a class needs reactive effects outside a component lifecycle, use `$effect.root()` — it creates a standalone reactive root. Store the returned cleanup and call it in `dispose()`.

## Bug Fixes

When a bug is reported:

1. **Write a failing test first.** Before touching the bug, add a test that reproduces it and confirm it fails. This proves the bug exists and defines done.
2. **Then fix the bug.** Run tests again to confirm the new test passes and nothing else broke.
3. **Never skip step 1.** Fixing first and testing after risks writing a test that passes regardless of the fix.

### When investigation gets stuck

If you've spent more than ~3 rounds of code-reading without converging on the cause, **stop speculating and add `console.log` traces** at the suspect call sites. Ask the user to reproduce and report what the logs show. Real runtime values beat any amount of static analysis. Remove the logs once the root cause is found.
