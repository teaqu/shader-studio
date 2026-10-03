<script lang="ts">
  import { onMount } from 'svelte';
  import { SETTING_DEFINITIONS } from './settingDefinitions';
  import type { StandaloneSettings } from './StandaloneSettings';

  interface Props { settings: StandaloneSettings; onClose: () => void; }
  let { settings, onClose }: Props = $props();
  let values = $state({ ...settings.snapshot });
  let search = $state('');
  let dialog: HTMLDialogElement;
  let searchInput: HTMLInputElement;
  const visible = $derived(SETTING_DEFINITIONS.filter((setting) =>
    `${setting.label} ${setting.description} ${setting.key}`.toLowerCase().includes(search.trim().toLowerCase())));

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  function closeOnBackdrop(event: MouseEvent) {
    if (event.target !== dialog) {
      return;
    }
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      onClose();
    }
  }

  onMount(() => {
    const previousFocus = document.activeElement;
    dialog.showModal();
    searchInput.focus();
    const unsubscribe = settings.subscribe((snapshot) => {
      values = { ...snapshot };
    });
    return () => {
      unsubscribe();
      dialog.close();
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  });
</script>

<dialog bind:this={dialog} aria-labelledby="standalone-settings-title" onkeydown={closeOnEscape} oncancel={(event) => {
  event.preventDefault();
  onClose();
}} onclick={closeOnBackdrop}>
  <header><h2 id="standalone-settings-title">Settings</h2><button aria-label="Close settings" onclick={onClose}>×</button></header>
  <p>Preferences for all shaders in this browser. Changes apply immediately.</p>
  <input class="search" bind:this={searchInput} bind:value={search} type="search" aria-label="Search settings" placeholder="Search settings" />
  <div class="settings-list">
    {#each ['Preview', 'Language services', 'Editor'] as group}
      {#if visible.some((setting) => setting.group === group)}
        <section aria-label={group}><h3>{group}</h3>
          {#each visible.filter((setting) => setting.group === group) as setting (setting.key)}
            <div class="setting">
              <label for={`setting-${setting.key}`}>{setting.label}</label>
              {#if setting.kind === 'boolean'}
                <input id={`setting-${setting.key}`} type="checkbox" checked={values[setting.key] === true} onchange={(event) => settings.update(setting.key, event.currentTarget.checked)} />
              {:else if setting.kind === 'number'}
                <input id={`setting-${setting.key}`} type="number" min={setting.min} max={setting.max} step="1" value={Number(values[setting.key])} onchange={(event) => {
                  settings.update(setting.key, event.currentTarget.valueAsNumber);
                  event.currentTarget.value = String(settings.snapshot[setting.key]);
                }} />
              {:else}
                <select id={`setting-${setting.key}`} value={String(values[setting.key])} onchange={(event) => settings.update(setting.key, event.currentTarget.value)}><option value="on">On</option><option value="off">Off</option></select>
              {/if}
              <small>{setting.description}</small>
            </div>
          {/each}
        </section>
      {/if}
    {/each}
    {#if visible.length === 0}<p role="status">No matching settings.</p>{/if}
  </div>
  <footer><button onclick={() => settings.reset()}>Reset all settings</button><button onclick={onClose}>Done</button></footer>
</dialog>

<style>
  dialog { width: min(620px, calc(100vw - 48px)); max-height: calc(100vh - 64px); box-sizing: border-box; padding: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  dialog::backdrop { background: rgb(0 0 0 / 45%); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 { margin: 0; font-size: 18px; } h3 { font-size: 14px; margin: 20px 0 12px; }
  p, small { color: var(--vscode-descriptionForeground); }
  .search { width: 100%; box-sizing: border-box; }
  .settings-list { max-height: 55vh; overflow-y: auto; padding-right: 8px; }
  .setting { display: grid; grid-template-columns: 1fr 90px; gap: 6px 16px; margin-bottom: 16px; align-items: center; }
  .setting small { grid-column: 1 / -1; } input[type='checkbox'] { justify-self: end; }
  input, select { padding: 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
  button { padding: 6px 12px; cursor: pointer; } footer { margin-top: 16px; }
</style>
