<svelte:options runes={true} />
<script lang="ts">
  import {
    getActiveProfile, getProfileList,
    switchTo, saveAs, saveProfile, renameProfile, deleteProfile, reorderProfiles,
  } from '../state/profileStore.svelte';

  interface Props { onclose: () => void; }
  let { onclose }: Props = $props();

  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  let newProfileName = $state('');
  let confirmingSaveId = $state<string | null>(null);
  let dragSourceIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  function handleDragStart(index: number) {
    dragSourceIndex = index;
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    dragOverIndex = index;
  }

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragSourceIndex === null || dragSourceIndex === index) {
      dragSourceIndex = null;
      dragOverIndex = null;
      return;
    }
    const list = [...getProfileList()];
    const [moved] = list.splice(dragSourceIndex, 1);
    list.splice(index, 0, moved);
    reorderProfiles(list);
    dragSourceIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    dragSourceIndex = null;
    dragOverIndex = null;
  }

  function startRename(id: string, currentName: string) {
    renamingId = id;
    renameValue = currentName;
  }

  async function confirmRename() {
    if (renamingId && renameValue.trim()) {
      await renameProfile(renamingId, renameValue.trim());
    }
    renamingId = null;
  }

  function cancelRename() {
    renamingId = null; 
  }

  async function handleSaveAs() {
    const name = newProfileName.trim();
    if (!name) {
      return;
    }
    await saveAs(name);
    newProfileName = '';
  }

  async function handleDelete(id: string) {
    if (getProfileList().length <= 1) {
      return;
    }
    await deleteProfile(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={onclose} role="presentation">
  <div class="modal-content" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-label="Manage Profiles" tabindex="-1">
    <div class="modal-header">
      <span class="modal-title">Manage Profiles</span>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>

    <div class="profile-list" role="list">
      {#each getProfileList() as profile, index}
        {@const isActive = profile.id === getActiveProfile()}
        {@const isRenaming = renamingId === profile.id}
        <div
          class="profile-row"
          class:active={isActive}
          class:drag-over={dragOverIndex === index && dragSourceIndex !== index}
          role="listitem"
          draggable={!isRenaming}
          ondragstart={() => handleDragStart(index)}
          ondragover={(e) => handleDragOver(e, index)}
          ondrop={(e) => handleDrop(e, index)}
          ondragend={handleDragEnd}
        >
          <span class="drag-handle" aria-hidden="true">
            <i class="codicon codicon-gripper"></i>
          </span>
          <span class="check-col">
            {#if isActive}<i class="codicon codicon-check"></i>{/if}
          </span>

          {#if isRenaming}
            <input
              class="rename-input"
              bind:value={renameValue}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  confirmRename();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  cancelRename();
                }
              }}
            />
            <span class="rename-hint">↵ save · esc cancel</span>
          {:else}
            <button class="profile-name-btn" onclick={() => !isActive && switchTo(profile.id)}>
              {profile.name}
            </button>
            <button class="icon-btn" onclick={() => startRename(profile.id, profile.name)} title="Rename" aria-label="Rename {profile.name}">
              <i class="codicon codicon-edit"></i>
            </button>
            {#if isActive}
              {#if confirmingSaveId === profile.id}
                <span class="confirm-save-label">Are you sure?</span>
                <button class="text-btn confirm-save-yes" onclick={async () => {
                  await saveProfile(); confirmingSaveId = null;
                }} aria-label="Confirm save">Yes</button>
                <button class="text-btn confirm-save-no" onclick={() => {
                  confirmingSaveId = null;
                }} aria-label="Cancel save">Cancel</button>
              {:else}
                <button class="icon-btn save-current-btn" onclick={() => {
                  confirmingSaveId = profile.id;
                }} title="Save current layout to this profile" aria-label="Save {profile.name}">
                  <i class="codicon codicon-save"></i>
                </button>
              {/if}
            {/if}
            <button
              class="icon-btn delete-btn"
              onclick={() => handleDelete(profile.id)}
              title="Delete profile"
              aria-label="Delete {profile.name}"
              disabled={getProfileList().length <= 1}
            >
              <i class="codicon codicon-trash"></i>
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="modal-footer">
      <div class="footer-label">Save current layout as new profile</div>
      <div class="footer-row">
        <input
          class="new-profile-input"
          placeholder="Profile name…"
          bind:value={newProfileName}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              handleSaveAs();
            } 
          }}
        />
        <button class="save-btn" onclick={handleSaveAs} disabled={!newProfileName.trim()}>
          Save
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 20px;
  }
  .modal-content {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 6px;
    max-width: 480px; width: 100%; max-height: 90vh;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .modal-title { font-weight: 600; font-size: 13px; color: var(--vscode-editor-foreground); }
  .close-btn {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-editor-foreground); font-size: 16px; line-height: 1; padding: 0;
    opacity: 0.7;
  }
  .close-btn:hover { opacity: 1; }
  .profile-list { padding: 4px 0; flex: 1; overflow-y: auto; }
  .profile-row {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 12px;
  }
  .profile-row:hover { background: var(--vscode-list-hoverBackground); }
  .profile-row.active { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); }
  .drag-handle {
    width: 14px; flex-shrink: 0; display: flex; align-items: center;
    color: var(--vscode-editor-foreground); opacity: 0.3; cursor: grab;
  }
  .profile-row:hover .drag-handle { opacity: 0.7; }
  .drag-over { background: var(--vscode-list-focusBackground, var(--vscode-focusBorder, #007acc22)) !important; outline: 1px solid var(--vscode-focusBorder, #007acc); outline-offset: -1px; }
  .check-col { width: 16px; text-align: center; flex-shrink: 0; color: var(--vscode-editor-foreground); }
  .profile-name-btn {
    flex: 1; background: none; border: none; text-align: left;
    cursor: pointer; color: var(--vscode-editor-foreground); font-size: 12px; padding: 0;
  }
  .profile-row.active .profile-name-btn { cursor: default; }
  .rename-input {
    flex: 1; font-size: 12px; padding: 2px 6px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 2px; color: var(--vscode-input-foreground); outline: none;
  }
  .rename-hint { font-size: 10px; color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground)); opacity: 0.6; white-space: nowrap; }
  .icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-editor-foreground); padding: 2px 4px; border-radius: 2px;
    opacity: 0.5; display: flex; align-items: center;
  }
  .icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .save-current-btn:hover { color: var(--vscode-terminal-ansiGreen, #4caf50); opacity: 1; }
  .delete-btn:hover { color: var(--vscode-errorForeground, #f44); opacity: 1; }
  .icon-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .confirm-save-label { font-size: 11px; color: var(--vscode-editor-foreground); opacity: 0.8; white-space: nowrap; }
  .text-btn {
    background: none; border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 3px; cursor: pointer; font-size: 11px;
    color: var(--vscode-editor-foreground); padding: 1px 8px;
  }
  .text-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .confirm-save-yes { border-color: var(--vscode-button-background); color: var(--vscode-button-background); }
  .confirm-save-yes:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .modal-footer {
    border-top: 1px solid var(--vscode-panel-border);
    padding: 10px 12px;
  }
  .footer-label { font-size: 10px; color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground)); opacity: 0.6; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
  .footer-row { display: flex; gap: 8px; }
  .new-profile-input {
    flex: 1; font-size: 12px; padding: 4px 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 2px; color: var(--vscode-input-foreground); outline: none;
  }
  .new-profile-input:focus { border-color: var(--vscode-focusBorder); }
  .save-btn {
    background: var(--vscode-button-background);
    border: 1px solid transparent; color: var(--vscode-button-foreground); cursor: pointer;
    font-size: 12px; padding: 4px 14px; border-radius: 2px;
  }
  .save-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
