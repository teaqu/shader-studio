# AGENTS.md

Guide for AI agents working on this codebase.

## Project Structure

Monorepo with Turborepo. Key packages:

- `ui/` — Svelte 5 frontend (shader viewer, editor, config panels)
- `types/` — Shared TypeScript types (`@shader-studio/types`)
- `rendering/` — WebGL pipeline logic
- `extension/` — VS Code extension host
- `electron/` — Electron shell
- `debug/` — Shared GLSL and Slang debug tooling

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

When adding or changing behavior, tests are part of the implementation, not a separate follow-up. Before marking a slice done, explicitly ask: which public contract changed, which parser/type branch changed, which runtime branch changed, and which error/fallback path changed? Add or update tests for each relevant layer in the same change. For example, adding a new shader input kind must cover config/pass-graph parsing, resource loading, render-time binding, warnings/fallbacks, and public controls/state when those paths exist. Do not stop at a single happy-path runtime test if lower-level graph/type behavior or error paths changed too.

Test structure mirrors `src/lib/`: unit tests in `src/test/`, component tests in `src/test/components/`.

For rendering pipeline bugs, keep WebGL and WebGPU/Slang coverage in sync when applicable. If an issue appears in one pipeline and the equivalent behavior exists in the other, add or verify tests for both paths rather than only testing the pipeline where the bug was first observed.

## Extension Development Builds

Do not run the full root `npm run build` merely to prepare changes for manual testing in the Extension Development Host. Both VS Code launch configurations use the default build task, which runs `extension`'s `compile` script and rebuilds/copies the UI bundle when the user launches or restarts the extension with the green debug button.

Package-level builds and type checks are still required when they are relevant verification for the files changed. Only skip the redundant full extension build before manual testing.

## Linting

ESLint is enforced. **Always run ESLint after making changes:**

```sh
npx eslint --fix
```

Do not commit code with lint errors.

**Always run the full UI type check after making changes:**

```sh
cd ui && npm run check
```

This runs `svelte-check --tsconfig ./tsconfig.app.json` and the Node TypeScript check. Fix all errors and warnings it reports — including Svelte-specific diagnostics like non-reactive updates (`$state` missing), unused props, and type errors that `tsc` alone won't catch.

For quick local iteration on `.svelte` files, `cd ui && npx svelte-check` is useful, but it does not replace `npm run check`.

Always prefer Svelte 5 conventions over Svelte 4. For example: runes over stores, `$state`/`$derived`/`$effect` over `$:` reactivity, module-level `.svelte.ts` state or context over prop drilling.

## Conventions

- Never add `Co-Authored-By` trailers or any other AI-generated attribution to
  commits or pull requests. This repository is not an AI billboard.
- Treat `.gitignore` as authoritative. Never force-add an ignored file with
  `git add -f` (including generated artifacts and workflow planning/spec files)
  unless the user explicitly asks for that exact ignored file to be tracked.
  Skill or workflow instructions to commit a file do not override the
  repository's ignore rules.
- `docs/superpowers/` and `.superpowers/` are local-only locations. Files may
  exist there locally, but they must remain ignored and must never be staged or
  committed. Keep workflow plans and design notes out of Git history.
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
2. **Add unit regression coverage, then fix the bug.** Every bug fix must include automated unit tests for the underlying behavior, including relevant branches, edge cases, and error/fallback paths. Confirm the unit regression test fails before the fix, then run it and the relevant existing tests after the fix. For user-facing bugs, both unit tests and the automated end-to-end test in step 5 are required; neither replaces the other.
3. **Never skip step 1.** Fixing first and testing after risks writing a test that passes regardless of the fix.
4. **Do not apply band-aids.** Do not widen timeouts, add retries, skip assertions, serialize work, or change CI environments merely to make a failure disappear. First identify and fix the underlying race, state leak, or product defect. Make an exception only when evidence establishes that the previous limit or execution policy was invalid; document that evidence in the change.
5. **Add and run an automated end-to-end regression test for user-facing bugs.** The test must exercise the actual user action in the running affected host (standalone, VS Code extension, or Electron), assert the visible result, and check persistence after reload when relevant. Confirm it fails before the fix and passes afterward, and keep it in the repository's automated test suite. Manual testing, a host-handler unit test, a mocked component test, lint, or type checks do not replace this requirement. For example, a standalone Fork regression test must click the Fork menu action and verify that the copied shader opens, appears in the explorer, and survives reload. If the necessary test harness is missing, add the support needed to automate the flow; do not silently omit the regression test.
6. **Report verification precisely.** State which tests and app flows actually ran and their results. If runtime verification is blocked, state the concrete blocker and the unverified flow; do not claim the fix is fully verified or silently substitute unit tests for app verification.

## Releases

- Every new extension release must add an entry for the new version to `extension/CHANGELOG.md`.
- Update the changelog before creating or pushing the release tag. Never tag a release whose changelog entry is missing.

### When investigation gets stuck

If you've spent more than ~3 rounds of code-reading without converging on the cause, **stop speculating and add `console.log` traces** at the suspect call sites. Ask the user to reproduce and report what the logs show. Real runtime values beat any amount of static analysis. Remove the logs once the root cause is found.
