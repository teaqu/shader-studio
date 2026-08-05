<svelte:options runes={true} />

<script lang="ts">
  import type { StorageBufferConfig } from '@shader-studio/types';
  import type { ConfigFieldErrors } from '../../config/ComputeConfigMutations';
  import type { StorageBufferSnapshot } from '@shader-studio/types';
  import StorageInspector from './StorageInspector.svelte';
  import { getBuiltinStorageStride } from '../../config/StorageTypeLayout';

  interface Props {
    name: string;
    declaration: StorageBufferConfig;
    existingNames: string[];
    referencedBy: string[];
    onApply: (originalName: string, name: string, declaration: StorageBufferConfig) => ConfigFieldErrors;
    onDelete: (name: string) => ConfigFieldErrors;
    onDeleted?: () => void;
    onRead?: (name: string, start: number, count: number) => Promise<StorageBufferSnapshot>;
    onWrite?: (name: string, start: number, data: ArrayBuffer) => Promise<void>;
  }

  let { name, declaration, existingNames, referencedBy, onApply, onDelete, onDeleted = () => {}, onRead, onWrite }: Props = $props();
  let draftName = $state(name);
  let count = $state(String(declaration.count));
  let stride = $state(String(declaration.stride));
  let elementType = $state(declaration.elementType);
  let errors = $state<ConfigFieldErrors>({});
  let inspecting = $state(false);

  const builtinStride = $derived(getBuiltinStorageStride(elementType));
  const effectiveStride = $derived(builtinStride ?? Number(stride));

  $effect(() => {
    draftName = name;
    count = String(declaration.count);
    stride = String(declaration.stride);
    elementType = declaration.elementType;
  });

  const dirty = $derived(draftName !== name || count !== String(declaration.count) || effectiveStride !== declaration.stride || elementType !== declaration.elementType);

  function draft(): StorageBufferConfig | null {
    const nextCount = Number(count);
    const nextStride = effectiveStride;
    const nextErrors: ConfigFieldErrors = {};
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(draftName)) {
      nextErrors.name = 'Use a valid shader identifier';
    } else if (draftName !== name && existingNames.includes(draftName)) {
      nextErrors.name = 'Storage buffer name is already in use';
    }
    if (!Number.isInteger(nextCount) || nextCount <= 0) {
      nextErrors.count = 'Enter a positive integer';
    }
    if (builtinStride === null && (!Number.isInteger(nextStride) || nextStride <= 0)) {
      nextErrors.stride = 'Enter a positive integer';
    }
    if (elementType.trim().length === 0) {
      nextErrors.elementType = 'Element type is required';
    }
    errors = nextErrors;
    return Object.keys(nextErrors).length === 0
      ? { count: nextCount, stride: nextStride, elementType: elementType.trim() }
      : null;
  }

  function apply() {
    const next = draft();
    if (!next) {
      return;
    }
    errors = onApply(name, draftName, next);
  }

  function cancel() {
    draftName = name;
    count = String(declaration.count);
    stride = String(declaration.stride);
    elementType = declaration.elementType;
    errors = {};
  }

  function deleteStorage() {
    errors = onDelete(name);
    if (Object.keys(errors).length === 0) {
      onDeleted();
    }
  }
</script>

<article class="storage-editor" data-storage-name={name}>
  <h3>{name}</h3>
  <label>Name<input name="storage-name" aria-label="Storage name" aria-invalid={errors.name ? 'true' : undefined} bind:value={draftName} /></label>
  <label>Element count<input aria-label="Element count" aria-invalid={errors.count ? 'true' : undefined} bind:value={count} /></label>
  <label>Element type<input aria-label="Element type" aria-invalid={errors.elementType ? 'true' : undefined} bind:value={elementType} /></label>
  {#if builtinStride === null}
    <label>Byte stride<input aria-label="Byte stride" aria-invalid={errors.stride ? 'true' : undefined} bind:value={stride} /></label>
  {/if}
  {#each Object.values(errors) as error}<p role="alert">{error}</p>{/each}
  {#if referencedBy.length > 0}
    <p role="alert">Cannot delete: used by {referencedBy.join(', ')}</p>
  {/if}
  <div class="actions">
    {#if dirty}<button onclick={apply} aria-label="Apply {name} changes">Apply</button><button onclick={cancel} aria-label="Cancel {name} changes">Cancel</button>{/if}
    {#if onRead && onWrite}<button onclick={() => inspecting = !inspecting} aria-label="Inspect {name}">{inspecting ? 'Hide inspector' : 'Inspect'}</button>{/if}
    {#if referencedBy.length === 0}<button onclick={deleteStorage} aria-label="Delete {name}">Delete</button>{/if}
  </div>
  {#if inspecting && onRead && onWrite}
    <StorageInspector {name} count={declaration.count} {onRead} {onWrite} onClose={() => inspecting = false} />
  {/if}
</article>

<style>
  .storage-editor { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 4px; }
  h3, p { margin: 0; } label { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; } input { min-width: 120px; padding: 4px 6px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; outline: none; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); font: inherit; } input:hover { background: var(--vscode-inputOption-hoverBackground, #454545); } input:focus { border-color: var(--vscode-focusBorder, #007fd4); } input[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground, #f48771)); } p { color: var(--vscode-errorForeground, #f48771); font-size: 12px; } .actions { display: flex; gap: 6px; }
</style>
