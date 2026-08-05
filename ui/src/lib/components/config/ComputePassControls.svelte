<svelte:options runes={true} />

<script lang="ts">
  import type { ComputePass } from '@shader-studio/types';
  import type { ConfigFieldErrors } from '../../config/ComputeConfigMutations';

  type DispatchMode = 'texel' | 'count' | 'workgroups' | 'storage' | 'channel';

  interface Props {
    pass: ComputePass;
    storageNames: string[];
    channelNames: string[];
    entryPointNames?: string[];
    onCommit: (pass: ComputePass) => ConfigFieldErrors;
  }

  let { pass, storageNames, channelNames, entryPointNames = [], onCommit }: Props = $props();
  let localErrors = $state<ConfigFieldErrors>({});
  let externalErrors = $state<ConfigFieldErrors>({});
  let countDraft = $state('');
  let rawWorkgroupDraft = $state(['1', '1', '1']);
  let repeatsDraft = $state('1');
  let layersDraft = $state('1');
  let runOnce = $state(pass.dispatchOnce === true);
  let activeMode = $state<DispatchMode>(getMode(pass));

  const errors = $derived({ ...localErrors, ...externalErrors });
  const mode = $derived(activeMode);

  $effect(() => {
    const dispatch = pass.dispatch;
    countDraft = dispatch && 'count' in dispatch ? String(dispatch.count) : '';
    rawWorkgroupDraft = dispatch && 'x' in dispatch
      ? [String(dispatch.x), String(dispatch.y), String(dispatch.z)]
      : ['1', '1', '1'];
    repeatsDraft = String(pass.dispatchCount ?? 1);
    layersDraft = String(pass.outputLayers ?? 1);
    runOnce = pass.dispatchOnce === true;
    activeMode = getMode(pass);
  });

  function getMode(nextPass: ComputePass): DispatchMode {
    const dispatch = nextPass.dispatch;
    if (!dispatch) {
      return 'texel';
    }
    if ('count' in dispatch) {
      return 'count';
    }
    if ('x' in dispatch) {
      return 'workgroups';
    }
    if (storageNames.includes(dispatch.cover)) {
      return 'storage';
    }
    return 'channel';
  }

  function setError(field: string, message?: string) {
    if (message) {
      localErrors = { ...localErrors, [field]: message };
      return;
    }
    const { [field]: _removed, ...remaining } = localErrors;
    localErrors = remaining;
  }

  function positiveInteger(field: string, raw: string, max?: number): number | null {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
      setError(field, max === undefined ? 'Enter a positive integer' : `Enter an integer from 1 through ${max}`);
      return null;
    }
    setError(field);
    return value;
  }

  function commit(nextPass: ComputePass): boolean {
    externalErrors = onCommit(nextPass);
    return Object.keys(externalErrors).length === 0;
  }

  function clearExternal(field?: string) {
    if (!field) {
      externalErrors = {};
      return;
    }
    const { [field]: _removed, ...remaining } = externalErrors;
    externalErrors = remaining;
  }

  function setDispatchMode(nextMode: DispatchMode) {
    clearExternal('dispatch');
    activeMode = nextMode;
    if (nextMode === 'texel') {
      commit({ ...pass, dispatch: undefined });
    }
    if (nextMode === 'count') {
      commit({ ...pass, dispatch: { count: 1 } });
    }
    if (nextMode === 'workgroups') {
      commit({ ...pass, dispatch: { x: 1, y: 1, z: 1 } });
    }
    if (nextMode === 'storage') {
      commit({ ...pass, dispatch: { cover: storageNames[0] ?? '' } });
    }
    if (nextMode === 'channel') {
      commit({ ...pass, dispatch: { cover: channelNames[0] ?? '' } });
    }
  }

  function updateCount(value: string) {
    countDraft = value;
    commitCount();
  }

  function commitCount() {
    const value = positiveInteger('dispatch', countDraft);
    if (value !== null) {
      commit({ ...pass, dispatch: { count: value } });
    }
  }

  function updateRawWorkgroup(index: number, value: string) {
    rawWorkgroupDraft[index] = value;
    rawWorkgroupDraft = [...rawWorkgroupDraft];
    commitWorkgroups();
  }

  function commitWorkgroups() {
    const values = rawWorkgroupDraft.map((value) => positiveInteger('dispatch', value));
    if (values.some((value) => value === null)) {
      return;
    }
    commit({ ...pass, dispatch: { x: values[0]!, y: values[1]!, z: values[2]! } });
  }

  function setCover(cover: string) {
    clearExternal('dispatch');
    commit({ ...pass, dispatch: { cover } });
  }

  function updateRepeats(value: string) {
    repeatsDraft = value;
    commitRepeats();
  }

  function commitRepeats() {
    const value = positiveInteger('dispatchCount', repeatsDraft, 1024);
    if (value !== null) {
      commit({ ...pass, dispatchCount: value });
    }
  }

  function setRunOnce(enabled: boolean) {
    runOnce = enabled;
    clearExternal('dispatchOnce');
    if (enabled) {
      repeatsDraft = '1';
      commit({ ...pass, dispatchOnce: true, dispatchCount: 1 });
      return;
    }
    commit({ ...pass, dispatchOnce: undefined });
  }

  function updateLayers(value: string) {
    layersDraft = value;
    commitLayers();
  }

  function commitLayers() {
    const value = positiveInteger('outputLayers', layersDraft, 8);
    if (value !== null) {
      commit({ ...pass, outputLayers: value });
    }
  }

</script>

<section class="compute-controls" aria-label="Compute settings">
  {#if entryPointNames.length > 1}
    <label>Entrypoint
      <select aria-label="Entrypoint" value={pass.entryPoint ?? ''} onchange={(event) => commit({ ...pass, entryPoint: event.currentTarget.value })}>
        {#each entryPointNames as entryPoint}<option value={entryPoint}>{entryPoint}</option>{/each}
      </select>
    </label>
  {/if}
  <h3>Dispatch</h3>
  <label>
    Dispatch mode
    <select aria-label="Dispatch mode" value={mode} onchange={(event) => setDispatchMode(event.currentTarget.value as DispatchMode)}>
      <option value="texel">Output texels</option>
      <option value="count">Element count</option>
      <option value="workgroups">Raw workgroups</option>
      <option value="storage" disabled={storageNames.length === 0}>Cover storage buffer</option>
      <option value="channel" disabled={channelNames.length === 0}>Cover channel</option>
    </select>
  </label>
  {#if mode === 'count'}
    <label>Element count
      <input aria-label="Element count" aria-invalid={errors.dispatch ? 'true' : undefined} aria-describedby={errors.dispatch ? 'dispatch-error' : undefined} value={countDraft} oninput={(event) => updateCount(event.currentTarget.value)} />
    </label>
  {:else if mode === 'workgroups'}
    <div class="triple-row"><span>Raw workgroups</span>{#each ['X', 'Y', 'Z'] as axis, index}
      <label>{axis}<input aria-label="Raw workgroups {axis}" value={rawWorkgroupDraft[index]} oninput={(event) => updateRawWorkgroup(index, event.currentTarget.value)} /></label>
    {/each}</div>
  {:else if mode === 'storage' || mode === 'channel'}
    <label>{mode === 'storage' ? 'Storage buffer' : 'Channel'}
      <select aria-label={mode === 'storage' ? 'Storage buffer' : 'Channel'} value={pass.dispatch && 'cover' in pass.dispatch ? pass.dispatch.cover : ''} onchange={(event) => setCover(event.currentTarget.value)}>
        {#each mode === 'storage' ? storageNames : channelNames as name}<option value={name}>{name}</option>{/each}
      </select>
    </label>
  {/if}
  {#if errors.dispatch}<p id="dispatch-error" role="alert">{errors.dispatch}</p>{/if}

  <h3>Execution</h3>
  <label class="checkbox-row">Run once
    <input class="themed-checkbox" aria-label="Run once" type="checkbox" checked={runOnce} onchange={(event) => setRunOnce(event.currentTarget.checked)} />
  </label>
  <label>Repeats<input aria-label="Repeats" disabled={runOnce} value={repeatsDraft} oninput={(event) => updateRepeats(event.currentTarget.value)} /></label>
  {#if errors.dispatchCount}<p role="alert">{errors.dispatchCount}</p>{/if}
  {#if errors.dispatchOnce}<p role="alert">{errors.dispatchOnce}</p>{/if}

  <h3>Output</h3>
  <label>Output layers<input aria-label="Output layers" value={layersDraft} oninput={(event) => updateLayers(event.currentTarget.value)} /></label>
  {#if errors.outputLayers}<p role="alert">{errors.outputLayers}</p>{/if}
</section>

<style>
  .compute-controls { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 8px 0 0; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); }
  label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  input, select { min-width: 72px; padding: 3px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
  .checkbox-row input { min-width: 0; padding: 0; }
  .themed-checkbox {
    appearance: none;
    width: 16px;
    height: 16px;
    border: 1px solid var(--vscode-checkbox-border, var(--vscode-input-border, #3c3c3c));
    border-radius: 3px;
    background: var(--vscode-checkbox-background, var(--vscode-input-background));
    cursor: pointer;
    display: grid;
    place-content: center;
  }
  .themed-checkbox::before {
    content: '';
    width: 8px;
    height: 4px;
    border: solid var(--vscode-checkbox-foreground, #fff);
    border-width: 0 0 2px 2px;
    transform: rotate(-45deg) scale(0);
  }
  .themed-checkbox:checked { background: var(--vscode-checkbox-selectBackground, var(--vscode-focusBorder, #007fd4)); }
  .themed-checkbox:checked::before { transform: rotate(-45deg) scale(1); }
  .themed-checkbox:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
  .triple-row { display: flex; gap: 8px; align-items: center; }
  .triple-row label { flex-direction: column; align-items: flex-start; gap: 3px; }
  p { margin: 0; color: var(--vscode-errorForeground, #f48771); font-size: 12px; }
</style>
