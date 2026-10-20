<svelte:options runes={true} />

<script lang="ts">
  import { isPositiveInteger, resolveGpuBackpressure, type GpuBackpressureSettings } from "@shader-studio/types";
  import { getGpuBackpressureDefaults } from "../../state/gpuBackpressureState.svelte";

  interface Props {
    settings?: Partial<GpuBackpressureSettings>;
    onUpdate: (settings: Partial<GpuBackpressureSettings> | undefined) => void;
  }

  let { settings, onUpdate }: Props = $props();
  const defaults = $derived(getGpuBackpressureDefaults());
  const effective = $derived(resolveGpuBackpressure(defaults, settings));
  const fields = [
    { key: "framesInFlight", label: "Frames in flight", description: "Maximum unfinished GPU frames before waiting to submit another.", unit: "" },
    { key: "stallTimeoutMs", label: "Stall timeout", description: "Maximum wait for GPU completion before allowing another frame.", unit: "ms" },
  ] as const;
  let error = $state("");

  function update(key: keyof GpuBackpressureSettings, value: number | undefined): void {
    if (value !== undefined && !isPositiveInteger(value)) {
      error = "Enter a whole number greater than zero.";
      return;
    }
    error = "";
    const next = { ...settings };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onUpdate(Object.keys(next).length ? next : undefined);
  }
</script>

<section aria-label="Rendering settings">
  <h3>GPU backpressure</h3>
  <p class="description">Applies to this shader and all its passes.</p>
  {#each fields as field}
    <div class="field">
      <div>
        <label for={`gpu-${field.key}`}>{field.label}</label>
        <p class="description">{field.description}</p>
        <label class="inherit">
          <input type="checkbox" checked={settings?.[field.key] === undefined}
            onchange={(event) => update(field.key, event.currentTarget.checked ? undefined : effective[field.key])} />
          Use global default ({defaults[field.key]}{field.unit ? ` ${field.unit}` : ""})
          <span class="sr-only">for {field.label.toLowerCase()}</span>
        </label>
      </div>
      <div class="value">
        <input id={`gpu-${field.key}`} type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1"
          aria-label={field.label} aria-describedby={`gpu-${field.key}-unit`}
          value={effective[field.key]} disabled={settings?.[field.key] === undefined}
          oninput={(event) => update(field.key, event.currentTarget.valueAsNumber)} />
        <span id={`gpu-${field.key}-unit`}>{field.unit}</span>
      </div>
    </div>
  {/each}
  {#if error}<p role="alert">{error}</p>{/if}
  <p class="effective" aria-live="polite">Effective: {effective.framesInFlight} frames in flight · {effective.stallTimeoutMs} ms stall timeout</p>
</section>

<style>
  section { padding: 16px; }
  h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; }
  .description { margin: 4px 0 8px; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .field { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 16px; margin-top: 22px; }
  .inherit { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .value { display: flex; gap: 6px; align-items: start; }
  .value input { width: 100%; min-width: 0; padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
  .value input:disabled { opacity: 0.55; }
  .effective { border-top: 1px solid var(--vscode-panel-border); margin: 20px 0 0; padding-top: 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }
  [role="alert"] { color: var(--vscode-errorForeground); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  @media (max-width: 360px) { .field { grid-template-columns: 1fr; } .value { max-width: 130px; } }
</style>
