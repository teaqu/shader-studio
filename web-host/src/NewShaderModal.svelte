<svelte:options runes={true} />
<script lang="ts">
  interface Props {
    onCreate: (name: string, language: 'glsl' | 'slang') => void;
    onClose: () => void;
  }

  let { onCreate, onClose }: Props = $props();
  let name = $state('untitled');
  let language = $state<'glsl' | 'slang'>('glsl');

  function submit() {
    const trimmedName = name.trim();
    if (trimmedName) {
      onCreate(trimmedName, language);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={(event) => {
  if (event.target === event.currentTarget) {
    onClose();
  } 
}} role="presentation">
  <div class="modal-content" role="dialog" aria-modal="true" aria-label="New Shader" tabindex="-1">
    <form onsubmit={(event) => {
      event.preventDefault(); submit(); 
    }}>
      <div class="modal-header">
        <h2>New Shader</h2>
        <button type="button" class="close-button" onclick={onClose} aria-label="Close new shader dialog">×</button>
      </div>
      <label>
        Name
        <input bind:value={name} aria-label="Shader name" />
      </label>
      <label>
        Language
        <select bind:value={language} aria-label="Shader language">
          <option value="glsl">GLSL</option>
          <option value="slang">Slang</option>
        </select>
      </label>
      <div class="actions">
        <button type="button" onclick={onClose}>Cancel</button>
        <button type="submit">Create Shader</button>
      </div>
    </form>
  </div>
</div>

<style>
  .modal-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgb(0 0 0 / 35%); }
  .modal-content { width: min(400px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--vscode-notifications-border); border-radius: 6px; background: var(--vscode-notifications-background); color: var(--vscode-editor-foreground); box-shadow: 0 8px 28px rgb(0 0 0 / 20%); }
  .modal-header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h2 { margin: 0; font-size: 18px; }
  label { display: grid; gap: 6px; margin-top: 16px; }
  input, select { box-sizing: border-box; width: 100%; padding: 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .actions { justify-content: flex-end; margin-top: 20px; }
  button { padding: 6px 12px; }
  .actions button[type="button"] { color: var(--vscode-editor-foreground); background: var(--vscode-list-hoverBackground); }
  .close-button { padding: 0 4px; border: 0; color: inherit; background: transparent; font-size: 22px; }
</style>
