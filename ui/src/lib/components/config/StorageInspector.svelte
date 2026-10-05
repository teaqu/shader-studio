<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import {
    storageValueLayout,
    type StorageBufferSnapshot,
    type StorageCapturePoint,
  } from "@shader-studio/types";
  import {
    snapshotFields,
    readSnapshotField,
    formatStorageValue,
  } from "../../config/StorageSnapshotValues";
  import {
    getStorageView,
    selectStorageField,
  } from "../../state/storageViewState.svelte";
  interface Props {
    name: string;
    count: number;
    scope?: string;
    passes?: string[];
    onRead: (
      name: string,
      start: number,
      count: number,
      point?: StorageCapturePoint,
    ) => Promise<StorageBufferSnapshot>;
  }
  let { name, count, scope = "", passes = [], onRead }: Props = $props();
  const PAGE_SIZE = 16;
  let start = $state(0);
  let snapshot = $state<StorageBufferSnapshot | null>(null);
  let loading = $state(false);
  let live = $state(false);
  let error = $state("");
  let point = $state("");
  let hex = $state(false);
  let requestVersion = 0;
  let disposed = false;
  const fields = $derived(snapshot ? snapshotFields(snapshot) : []);
  const field = $derived(
    fields.find((item) => item.name === getStorageView(scope).fields[name]) ??
      fields[0],
  );
  const layout = $derived(field ? storageValueLayout(field.type) : null);
  const values = $derived.by(() => {
    if (!snapshot || !field || !layout) {
      return { rows: [], error: "" };
    }
    try {
      return { rows: readSnapshotField(snapshot, field), error: "" };
    } catch (reason) {
      return {
        rows: [],
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
  });
  const stale = $derived(snapshot !== null && snapshot.start !== start);
  async function capture(): Promise<void> {
    if (loading || disposed || count <= 0) {
      return;
    }
    const version = ++requestVersion;
    const captureName = name;
    loading = true;
    error = "";
    const selectedPoint: StorageCapturePoint | undefined = point
      ? JSON.parse(point)
      : undefined;
    try {
      const result = await onRead(
        captureName,
        start,
        Math.min(PAGE_SIZE, count - start),
        selectedPoint,
      );
      if (version === requestVersion && !disposed && captureName === name) {
        snapshot = result;
      }
    } catch (reason) {
      if (version === requestVersion && !disposed) {
        error = reason instanceof Error ? reason.message : String(reason);
        live = false;
      }
    } finally {
      if (version === requestVersion && !disposed) {
        loading = false;
      }
    }
  }
  function navigate(next: number): void {
    start = Math.max(0, Math.min(count - 1, Math.floor(next) || 0));
    void capture();
  }
  $effect(() => {
    const currentName = name,
      currentCount = count;
    untrack(() => {
      requestVersion++;
      loading = false;
      snapshot = null;
      start = 0;
      live = false;
      if (currentName && currentCount > 0) {
        void capture();
      }
    });
    return () => {
      requestVersion++;
    };
  });
  $effect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => {
      void capture();
    }, 500);
    return () => clearInterval(timer);
  });
  onDestroy(() => {
    disposed = true;
    requestVersion++;
  });
</script>

<section class="storage-inspector" aria-label="Inspect {name}">
  <div class="inspector-heading">
    <h3>{name}</h3>
    <span>Read-only</span>
  </div>
  <div class="capture-options">
    <label
      >Capture point<select
        aria-label="Capture point"
        title="Latest values reads the buffer now. Before/after captures the next execution of a GPU pass."
        bind:value={point}
        onchange={() => {
          live = false;
          void capture();
        }}
        disabled={loading}
      >
        <option value="">Latest values</option>
        {#each passes as pass}<option
            value={JSON.stringify({ pass, timing: "before" })}
            >Before {pass}</option
          ><option value={JSON.stringify({ pass, timing: "after" })}
            >After {pass}</option
          >{/each}
      </select></label
    >
    <label
      >Display<select aria-label="Number display" bind:value={hex}
        ><option value={false}>Decimal</option><option value={true}
          >Hex · integers</option
        ></select
      ></label
    >
  </div>
  <div class="capture-actions">
    <button class="primary" onclick={capture} disabled={loading}
      >{loading ? "Reading…" : "Capture snapshot"}</button
    ><button
      aria-pressed={live}
      onclick={() => {
        live = !live;
        if (live) {
          void capture();
        }
      }}>{live ? "Pause live" : "Start live"}</button
    ><span>{live ? "Live · up to 2 updates/sec" : "Paused"}</span>
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if snapshot}
    <p class="capture-meta" aria-live="polite">
      {snapshot.frame === undefined ? "Snapshot" : `Frame ${snapshot.frame}`} · {snapshot.capturePoint
        ? `${snapshot.capturePoint.timing === "before" ? "Before" : "After"} ${snapshot.capturePoint.pass}`
        : "Latest values"}{stale ? " · Previous range" : ""}
    </p>
    {#if fields.length > 1}<label
        >Field<select
          aria-label="Inspect field"
          value={field?.name}
          onchange={(event) =>
            selectStorageField(scope, name, event.currentTarget.value)}
          >{#each fields as item}<option value={item.name}
              >{item.name} · {item.type}</option
            >{/each}</select
        ></label
      >{/if}
    {#if !fields.length}<p role="alert">
        Field layout unavailable for {snapshot.elementType}. Define a numeric
        layout or compile the shader successfully.
      </p>
    {:else if !layout}<p role="alert">
        {field?.type} cannot be displayed yet. Select a numeric scalar or vector field.
      </p>
    {:else if values.error}<p role="alert">{values.error}</p>
    {:else if layout.columns === 1}
      <div class="scalar-values" role="list" aria-label="{name} values">
        {#each values.rows as row, index}<div role="listitem">
            <span class="element-index">[{snapshot.start + index}]</span><output
              aria-label="Element {snapshot.start + index} value"
              >{formatStorageValue(row[0]!, field!.type, hex)}</output
            >
          </div>{/each}
      </div>
    {:else}
      <table aria-label="{name} {field?.name} values">
        <thead
          ><tr
            ><th scope="col">#</th>{#each Array(layout.columns) as _, index}<th
                scope="col">{["x", "y", "z", "w"][index]}</th
              >{/each}</tr
          ></thead
        ><tbody
          >{#each values.rows as row, index}<tr
              ><th scope="row">{snapshot.start + index}</th
              >{#each row as value, column}<td
                  ><output
                    aria-label="Element {snapshot.start +
                      index} component {column}"
                    >{formatStorageValue(value, field!.type, hex)}</output
                  ></td
                >{/each}</tr
            >{/each}</tbody
        >
      </table>
    {/if}
  {/if}
  <div class="range-controls">
    <label
      >First element<input
        aria-label="First element"
        type="number"
        min="0"
        max={count - 1}
        value={start}
        disabled={loading}
        onchange={(event) => navigate(Number(event.currentTarget.value))}
      /></label
    >
    <div>
      <button
        onclick={() => navigate(start - PAGE_SIZE)}
        disabled={loading || start === 0}>Previous</button
      ><button
        onclick={() => navigate(start + PAGE_SIZE)}
        disabled={loading || start + PAGE_SIZE >= count}>Next</button
      >
    </div>
  </div>
  <p class="range-status" aria-label="Element range">
    {start}–{Math.min(count - 1, start + PAGE_SIZE - 1)} of {count.toLocaleString()}
    elements
  </p>
</section>

<style>
  .storage-inspector {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .inspector-heading,
  .capture-actions,
  .range-controls,
  .range-controls > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  h3,
  p {
    margin: 0;
  }
  h3 {
    font-size: 13px;
    font-weight: 500;
  }
  label {
    display: grid;
    gap: 6px;
    font-size: 12px;
    color: var(--storage-muted, var(--vscode-descriptionForeground));
  }
  .capture-options {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  select,
  input {
    width: 100%;
    box-sizing: border-box;
    min-width: 0;
    font-size: 13px;
  }
  .capture-actions {
    justify-content: flex-start;
  }
  .capture-actions span,
  .inspector-heading span,
  .capture-meta,
  .range-status {
    font-size: 12px;
    color: var(--storage-muted, var(--vscode-descriptionForeground));
  }
  .capture-meta {
    padding: 10px 12px;
    background: var(--storage-soft);
    border-radius: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font: 12px/1.6 var(--vscode-editor-font-family, monospace);
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 10px 6px;
    border-bottom: 1px solid var(--storage-line);
    text-align: right;
    overflow-wrap: anywhere;
    font-weight: 400;
  }
  thead th,
  tbody th {
    color: var(--storage-muted, var(--vscode-descriptionForeground));
  }
  tr > :first-child {
    width: 40px;
    text-align: left;
  }
  .scalar-values {
    font: 14px/1.6 var(--vscode-editor-font-family, monospace);
    font-variant-numeric: tabular-nums;
  }
  .scalar-values > div {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr);
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid var(--storage-line);
  }
  .element-index {
    color: var(--storage-muted, var(--vscode-descriptionForeground));
    font-size: 12px;
  }
  .range-controls input {
    width: 85px;
  }
  p[role="alert"] {
    color: var(--vscode-errorForeground);
    font-size: 12px;
  }
  @container (max-width: 420px) {
    .capture-options {
      grid-template-columns: 1fr;
    }
    th,
    td {
      padding: 9px 2px;
    }
    tr > :first-child {
      width: 28px;
    }
  }
</style>
