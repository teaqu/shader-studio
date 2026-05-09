<svelte:options runes={true} />
<script lang="ts">
  import {
    getActiveProfile, getProfileList,
    switchTo, saveAs, renameProfile, deleteProfile,
  } from '../state/profileStore.svelte';

  interface Props { onclose: () => void; }
  let { onclose }: Props = $props();

  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  let newProfileName = $state('');

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

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-label="Manage Profiles" tabindex="-1">
    <div class="modal-header">
      <span class="modal-title">Manage Profiles</span>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>

    <div class="profile-list">
      {#each getProfileList() as profile}
        {@const isActive = profile.id === getActiveProfile()}
        {@const isRenaming = renamingId === profile.id}
        <div class="profile-row" class:active={isActive}>
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
                } if (e.key === 'Escape') {
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
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--editor-background, #252525);
    border: 1px solid var(--border-color, rgba(128,128,128,0.3));
    border-radius: 8px;
    width: 360px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    overflow: hidden;
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color, rgba(128,128,128,0.3));
  }
  .modal-title { font-weight: bold; font-size: 13px; }
  .close-btn {
    background: none; border: none; cursor: pointer;
    color: var(--foreground, #ccc); font-size: 16px; line-height: 1; padding: 0;
  }
  .profile-list { padding: 6px 0; }
  .profile-row {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 14px;
  }
  .profile-row.active { background: rgba(74,138,224,0.15); }
  .check-col { width: 16px; text-align: center; flex-shrink: 0; }
  .profile-name-btn {
    flex: 1; background: none; border: none; text-align: left;
    cursor: pointer; color: var(--foreground, #ccc); font-size: 12px; padding: 0;
  }
  .profile-row.active .profile-name-btn { cursor: default; }
  .rename-input {
    flex: 1; font-size: 12px; padding: 2px 6px;
    background: var(--input-background, #111);
    border: 1px solid var(--focus-border, #4a8ae0);
    border-radius: 3px; color: var(--foreground, #eee); outline: none;
  }
  .rename-hint { font-size: 10px; color: var(--foreground, #666); opacity: 0.5; white-space: nowrap; }
  .icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--foreground, #888); padding: 2px 4px; border-radius: 3px;
    opacity: 0.6; display: flex; align-items: center;
  }
  .icon-btn:hover { opacity: 1; }
  .delete-btn:hover { color: #e05; }
  .icon-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .modal-footer {
    border-top: 1px solid var(--border-color, rgba(128,128,128,0.3));
    padding: 10px 14px;
  }
  .footer-label { font-size: 10px; opacity: 0.5; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
  .footer-row { display: flex; gap: 8px; }
  .new-profile-input {
    flex: 1; font-size: 12px; padding: 5px 8px;
    background: var(--input-background, #1a1a1a);
    border: 1px solid var(--border-color, #3a3a3a);
    border-radius: 4px; color: var(--foreground, #eee); outline: none;
  }
  .save-btn {
    background: var(--button-background, #2d5a8e);
    border: none; color: #fff; cursor: pointer;
    font-size: 12px; padding: 5px 14px; border-radius: 4px;
  }
  .save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
