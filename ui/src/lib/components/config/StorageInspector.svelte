<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import type { StorageBufferSnapshot } from '@shader-studio/types';

  interface Props {
    name: string;
    count: number;
    onRead: (name: string, start: number, count: number) => Promise<StorageBufferSnapshot>;
    onWrite: (name: string, start: number, data: ArrayBuffer) => Promise<void>;
    onClose: () => void;
  }

  type ScalarKind = 'float' | 'int' | 'uint';
  interface Layout { kind: ScalarKind; columns: number; }

  let { name, count, onRead, onWrite, onClose }: Props = $props();
  const PAGE_SIZE = 100;
  let page = $state(0);
  let snapshot = $state<StorageBufferSnapshot | null>(null);
  let values = $state<number[][]>([]);
  let loading = $state(false);
  let writing = $state(false);
  let error = $state<string | null>(null);
  let saveQueued = false;

  const layout = $derived.by<Layout | null>(() => {
    if (!snapshot) {
      return null;
    }
    const match = /^(float|int|uint)([1-4])?$/.exec(snapshot.elementType.trim());
    return match ? { kind: match[1] as ScalarKind, columns: Number(match[2] ?? '1') } : null;
  });
  const pageCount = $derived(Math.max(1, Math.ceil(count / PAGE_SIZE)));
  const pageItems = $derived.by<Array<number | 'ellipsis'>>(() => {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index);
    }
    const start = Math.min(Math.max(page - 2, 0), pageCount - 5);
    const nearby = Array.from({ length: 5 }, (_, index) => start + index);
    const items: Array<number | 'ellipsis'> = [];
    if (nearby[0] !== 0) {
      items.push(0, 'ellipsis');
    }
    items.push(...nearby);
    if (nearby.at(-1) !== pageCount - 1) {
      items.push('ellipsis', pageCount - 1);
    }
    return items;
  });

  function snapshotValues(next: StorageBufferSnapshot, nextLayout: Layout): number[][] {
    const view = new DataView(next.data);
    return Array.from({ length: next.count }, (_, row) => Array.from({ length: nextLayout.columns }, (_, column) => {
      const offset = row * next.stride + column * 4;
      if (offset + 4 > next.data.byteLength) {
        return 0;
      }
      if (nextLayout.kind === 'float') {
        return view.getFloat32(offset, true);
      }
      return nextLayout.kind === 'int' ? view.getInt32(offset, true) : view.getUint32(offset, true);
    }));
  }

  async function refresh() {
    const rangeStart = page * PAGE_SIZE;
    const rangeCount = Math.min(PAGE_SIZE, count - rangeStart);
    loading = true;
    error = null;
    try {
      const next = await onRead(name, rangeStart, rangeCount);
      const match = /^(float|int|uint)([1-4])?$/.exec(next.elementType.trim());
      if (!match) {
        error = `${next.elementType} is not editable yet. Use float, int, uint, or their 2–4 component forms.`;
        snapshot = next;
        values = [];
        return;
      }
      const nextLayout = { kind: match[1] as ScalarKind, columns: Number(match[2] ?? '1') };
      snapshot = next;
      values = snapshotValues(next, nextLayout);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loading = false;
    }
  }

  function selectPage(nextPage: number) {
    if (nextPage === page || nextPage < 0 || nextPage >= pageCount) {
      return;
    }
    page = nextPage;
    void refresh();
  }

  function updateValue(row: number, column: number, value: string) {
    const next = Number(value);
    if (!Number.isFinite(next)) {
      return;
    }
    values[row]![column] = next;
    values = values;
    void saveValues();
  }

  async function saveValues() {
    if (!snapshot || !layout) {
      return;
    }
    if (writing) {
      saveQueued = true;
      return;
    }
    writing = true;
    try {
      do {
        saveQueued = false;
        const activeSnapshot = snapshot;
        const activeLayout = layout;
        if (!activeSnapshot || !activeLayout) {
          return;
        }
        const data = new ArrayBuffer(activeSnapshot.count * activeSnapshot.stride);
        const view = new DataView(data);
        for (let row = 0; row < values.length; row += 1) {
          for (let column = 0; column < activeLayout.columns; column += 1) {
            const offset = row * activeSnapshot.stride + column * 4;
            const value = values[row]![column]!;
            if (activeLayout.kind === 'float') {
              view.setFloat32(offset, value, true);
            } else if (activeLayout.kind === 'int') {
              view.setInt32(offset, value, true);
            } else {
              view.setUint32(offset, value, true);
            }
          }
        }
        error = null;
        await onWrite(name, activeSnapshot.start, data);
      } while (saveQueued);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      writing = false;
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

<section class="storage-inspector" aria-label="Inspect {name}">
  <div class="header"><h3>Inspect {name}</h3><button onclick={onClose}>Close</button></div>
  <div class="toolbar">
    <div class="pagination" aria-label="Storage pages">
      {#each pageItems as item, index (index)}
        {#if item === 'ellipsis'}<span aria-hidden="true">…</span>{:else}<button class:active={item === page} onclick={() => selectPage(item)} aria-label="Page {item + 1}" aria-current={item === page ? 'page' : undefined}>{item + 1}</button>{/if}
      {/each}
    </div>
    <div class="actions"><button onclick={refresh} disabled={loading}>{loading ? 'Reading…' : 'Refresh'}</button>{#if writing}<span aria-live="polite">Saving…</span>{/if}</div>
  </div>
  <p class="page-status" aria-label="Page status">Page {page + 1} of {pageCount}</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if snapshot && layout}
    <p class="meta">{snapshot.elementType} · elements {snapshot.start}–{snapshot.start + snapshot.count - 1}</p>
    <div class="grid-scroll">
      <table aria-label="{name} values">
        <thead><tr><th>Index</th>{#each Array(layout.columns) as _, index}<th>{['x', 'y', 'z', 'w'][index]}</th>{/each}</tr></thead>
        <tbody>{#each values as row, rowIndex}<tr><th>{snapshot.start + rowIndex}</th>{#each row as value, columnIndex}<td><input aria-label={`Element ${snapshot.start + rowIndex} component ${columnIndex}`} type="number" value={value} oninput={(event) => updateValue(rowIndex, columnIndex, event.currentTarget.value)} /></td>{/each}</tr>{/each}</tbody>
      </table>
    </div>
    <div class="pagination bottom" aria-label="Storage pages">
      {#each pageItems as item, index (index)}
        {#if item === 'ellipsis'}<span aria-hidden="true">…</span>{:else}<button class:active={item === page} onclick={() => selectPage(item)} aria-label="Page {item + 1}" aria-current={item === page ? 'page' : undefined}>{item + 1}</button>{/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .storage-inspector { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--vscode-focusBorder, #007fd4); border-radius: 4px; } .header, .toolbar, .pagination, .actions { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; } .toolbar { justify-content: space-between; } h3, p { margin: 0; } .pagination button { min-width: 28px; padding: 2px 6px; } .pagination button.active { outline: 1px solid var(--vscode-focusBorder, #007fd4); background: var(--vscode-button-background); color: var(--vscode-button-foreground); } .bottom { justify-content: center; } .page-status { font-size: 12px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; } .meta { font-size: 12px; color: var(--vscode-descriptionForeground); } p[role="alert"] { color: var(--vscode-errorForeground, #f48771); font-size: 12px; } .grid-scroll { overflow: auto; max-height: 360px; border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 3px; } table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 12px; } th, td { padding: 5px 7px; border-right: 1px solid var(--vscode-panel-border, #3c3c3c); border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); } tr > :last-child { border-right: 0; } tbody tr:last-child > * { border-bottom: 0; } thead th { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); font-size: 11px; font-weight: 600; } tbody th { background: var(--vscode-editor-background); color: var(--vscode-descriptionForeground); text-align: right; font-variant-numeric: tabular-nums; } td { padding: 0; text-align: right; } td input { display: block; box-sizing: border-box; width: 100%; min-width: 5ch; padding: 6px 8px; border: 1px solid transparent; border-radius: 2px; outline: none; appearance: textfield; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); font: inherit; font-variant-numeric: tabular-nums; } td input:hover { background: var(--vscode-inputOption-hoverBackground, #454545); } td input:focus { border-color: var(--vscode-focusBorder, #007fd4); background: var(--vscode-input-background, #3c3c3c); } td input::-webkit-inner-spin-button, td input::-webkit-outer-spin-button { margin: 0; appearance: none; }
</style>
