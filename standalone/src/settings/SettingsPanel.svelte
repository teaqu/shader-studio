<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { currentTheme, applyThemeProfile } from '@shader-studio/ui/lib/stores/themeStore';
  import { SETTING_DEFINITIONS } from './settingDefinitions';
  import type { StandaloneSettings } from './StandaloneSettings';

  interface Props { settings: StandaloneSettings; onClose: () => void; }
  let { settings, onClose }: Props = $props();
  let values = $state(untrack(() => ({ ...settings.snapshot })));
  let search = $state('');
  let dialog: HTMLDialogElement;
  let searchInput: HTMLInputElement;
  const visible = $derived(SETTING_DEFINITIONS.filter((setting) =>
    `${setting.group} ${setting.label} ${setting.description} ${setting.key}`.toLowerCase().includes(search.trim().toLowerCase())));

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
    {#if !search.trim() || 'theme appearance light dark'.includes(search.trim().toLowerCase()) || visible.some((setting) => setting.group === 'Theme')}
      <section aria-label="Theme"><h3>Theme</h3>
        {#each visible.filter((setting) => setting.group === 'Theme') as setting (setting.key)}
          <div class="setting">
            <label for={`setting-${setting.key}`}>{setting.label}</label>
            <select id={`setting-${setting.key}`} bind:value={() => String(values[setting.key]), (value) => settings.update(setting.key, value)}>
              {#each setting.choices as choice}<option value={choice.value}>{choice.label}</option>{/each}
            </select>
            <small>{setting.description}</small>
          </div>
        {/each}
        <div class="setting">
          <label for="setting-appearance">Appearance</label>
          <select id="setting-appearance" bind:value={() => $currentTheme, (value) => applyThemeProfile(value === 'dark' ? 'dark' : 'light')}>
            <option value="light">Light</option><option value="dark">Dark</option>
          </select>
          <small>Light or dark colors for your workspace. Also follows the preview's theme switch.</small>
        </div>
      </section>
    {/if}
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
                <select id={`setting-${setting.key}`} value={String(values[setting.key])} onchange={(event) => settings.update(setting.key, event.currentTarget.value)}>{#each setting.choices ?? [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] as choice}<option value={choice.value}>{choice.label}</option>{/each}</select>
              {/if}
              <small>{setting.description}</small>
            </div>
          {/each}
        </section>
      {/if}
    {/each}
    {#if visible.length === 0 && !'theme appearance light dark'.includes(search.trim().toLowerCase())}<p role="status">No matching settings.</p>{/if}
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
  .setting { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 6px 16px; margin-bottom: 16px; align-items: center; }
  .setting small { grid-column: 1 / -1; } input[type='checkbox'] { justify-self: end; }
  input:not([type='checkbox']), select { padding: var(--shader-studio-control-padding); min-width: 0; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); min-height: var(--shader-studio-control-height); }
  select { background: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); border-color: var(--vscode-dropdown-border, var(--vscode-input-border)); }
  button { padding: var(--shader-studio-control-padding); cursor: pointer; min-height: var(--shader-studio-control-height); } footer { margin-top: 16px; }
</style>
