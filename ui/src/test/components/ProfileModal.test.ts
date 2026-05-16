import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('../../lib/state/profileStore.svelte', () => ({
  getActiveProfile: vi.fn(() => 'default'),
  getProfileList: vi.fn(() => [
    { id: 'default', name: 'Default' },
    { id: 'wide-editor', name: 'Wide editor' },
  ]),
  switchTo: vi.fn(),
  saveAs: vi.fn(),
  saveProfile: vi.fn().mockResolvedValue(undefined),
  renameProfile: vi.fn(),
  deleteProfile: vi.fn(),
  reorderProfiles: vi.fn(),
}));

const twoProfiles = [
  { id: 'default', name: 'Default' },
  { id: 'wide-editor', name: 'Wide editor' },
];

describe('ProfileModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getProfileList } = await import('../../lib/state/profileStore.svelte');
    vi.mocked(getProfileList).mockReturnValue(twoProfiles);
  });

  async function renderModal() {
    const onclose = vi.fn();
    const result = render(
      (await import('../../lib/components/ProfileModal.svelte')).default,
      { props: { onclose } }
    );
    return { ...result, onclose };
  }

  it('renders profile list', async () => {
    await renderModal();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('Wide editor')).toBeTruthy();
  });

  it('marks active profile row with active class', async () => {
    await renderModal();
    const activeRow = document.querySelector('.profile-row.active');
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('Default');
  });

  it('calls onclose when X button clicked', async () => {
    const { onclose } = await renderModal();
    await fireEvent.click(screen.getByLabelText('Close'));
    expect(onclose).toHaveBeenCalled();
  });

  it('calls onclose when overlay is clicked', async () => {
    const { onclose } = await renderModal();
    await fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onclose).toHaveBeenCalled();
  });

  it('pressing Escape at window level closes the modal', async () => {
    const { onclose } = await renderModal();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onclose).toHaveBeenCalled();
  });

  it('clicking non-active profile calls switchTo', async () => {
    const { switchTo } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    await fireEvent.click(screen.getByText('Wide editor'));
    expect(switchTo).toHaveBeenCalledWith('wide-editor');
  });

  it('clicking active profile does not call switchTo', async () => {
    const { switchTo } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    await fireEvent.click(screen.getByText('Default'));
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('delete button calls deleteProfile', async () => {
    const { deleteProfile } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const deleteButtons = screen.getAllByLabelText(/delete/i);
    await fireEvent.click(deleteButtons[0]);
    expect(deleteProfile).toHaveBeenCalled();
  });

  it('footer Save button is disabled when name input is empty', async () => {
    await renderModal();
    const saveBtn = screen.getByText('Save') as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();
  });

  it('disables delete when only one profile', async () => {
    const { getProfileList } = await import('../../lib/state/profileStore.svelte');
    vi.mocked(getProfileList).mockReturnValue([{ id: 'default', name: 'Default' }]);
    await renderModal();
    const deleteButtons = screen.getAllByLabelText(/delete/i);
    expect(deleteButtons[0]).toBeDisabled();
  });

  it('calls saveAs when Save button clicked with a name', async () => {
    const { saveAs } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const input = screen.getByPlaceholderText(/profile name/i);
    await fireEvent.input(input, { target: { value: 'My Layout' } });
    await fireEvent.click(screen.getByText('Save'));
    expect(saveAs).toHaveBeenCalledWith('My Layout');
  });

  it('rename button shows input pre-filled with current name', async () => {
    await renderModal();
    const renameButtons = screen.getAllByTitle('Rename');
    await fireEvent.click(renameButtons[0]);
    const input = document.querySelector('.rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input?.value).toBe('Default');
  });

  it('pressing Enter in rename input calls renameProfile', async () => {
    const { renameProfile } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const renameButtons = screen.getAllByTitle('Rename');
    await fireEvent.click(renameButtons[0]);
    const input = document.querySelector('.rename-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'New Name' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameProfile).toHaveBeenCalledWith('default', 'New Name');
  });

  it('pressing Escape in rename input cancels without calling renameProfile', async () => {
    const { renameProfile } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const renameButtons = screen.getAllByTitle('Rename');
    await fireEvent.click(renameButtons[0]);
    const inputBefore = document.querySelector('.rename-input') as HTMLInputElement;
    expect(inputBefore).toBeTruthy();
    await fireEvent.keyDown(inputBefore, { key: 'Escape' });
    const inputAfter = document.querySelector('.rename-input');
    expect(inputAfter).toBeFalsy();
    expect(renameProfile).not.toHaveBeenCalled();
  });

  it('pressing Escape in rename input does not close the modal', async () => {
    const { onclose } = await renderModal();
    const renameButtons = screen.getAllByTitle('Rename');
    await fireEvent.click(renameButtons[0]);
    const input = document.querySelector('.rename-input') as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onclose).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-content')).toBeTruthy();
  });

  it('save button on active profile shows Are you sure confirmation', async () => {
    await renderModal();
    const saveBtn = screen.getByTitle('Save current layout to this profile');
    await fireEvent.click(saveBtn);
    expect(screen.getByText(/Are you sure/)).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('Yes in save confirmation calls saveProfile', async () => {
    const { saveProfile } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    await fireEvent.click(screen.getByTitle('Save current layout to this profile'));
    await fireEvent.click(screen.getByText('Yes'));
    expect(saveProfile).toHaveBeenCalled();
  });

  it('renders drag handles for each profile row', async () => {
    await renderModal();
    const handles = document.querySelectorAll('.drag-handle');
    expect(handles).toHaveLength(2);
  });

  function dragEv(type: string) {
    return new Event(type, { bubbles: true, cancelable: true });
  }

  it('dragging one row onto another calls reorderProfiles with new order', async () => {
    const { reorderProfiles } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const [row0, row1] = Array.from(document.querySelectorAll('.profile-row')) as HTMLElement[];
    row0.dispatchEvent(dragEv('dragstart'));
    await tick();
    row1.dispatchEvent(dragEv('dragover'));
    await tick();
    row1.dispatchEvent(dragEv('drop'));
    await tick();
    expect(reorderProfiles).toHaveBeenCalledWith([
      { id: 'wide-editor', name: 'Wide editor' },
      { id: 'default', name: 'Default' },
    ]);
  });

  it('dropping a row onto itself does not call reorderProfiles', async () => {
    const { reorderProfiles } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const [row0] = Array.from(document.querySelectorAll('.profile-row')) as HTMLElement[];
    row0.dispatchEvent(dragEv('dragstart'));
    await tick();
    row0.dispatchEvent(dragEv('dragover'));
    await tick();
    row0.dispatchEvent(dragEv('drop'));
    await tick();
    expect(reorderProfiles).not.toHaveBeenCalled();
  });

  it('dragging row 1 onto row 0 reorders correctly', async () => {
    const { reorderProfiles } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const [row0, row1] = Array.from(document.querySelectorAll('.profile-row')) as HTMLElement[];
    row1.dispatchEvent(dragEv('dragstart'));
    await tick();
    row0.dispatchEvent(dragEv('dragover'));
    await tick();
    row0.dispatchEvent(dragEv('drop'));
    await tick();
    expect(reorderProfiles).toHaveBeenCalledWith([
      { id: 'wide-editor', name: 'Wide editor' },
      { id: 'default', name: 'Default' },
    ]);
  });

  it('drag-over class is applied to the hovered row during drag', async () => {
    await renderModal();
    const [row0, row1] = Array.from(document.querySelectorAll('.profile-row')) as HTMLElement[];
    row0.dispatchEvent(dragEv('dragstart'));
    await tick();
    row1.dispatchEvent(dragEv('dragover'));
    await tick();
    expect(row1.classList.contains('drag-over')).toBe(true);
    expect(row0.classList.contains('drag-over')).toBe(false);
  });

  it('dragend clears drag-over class', async () => {
    await renderModal();
    const [row0, row1] = Array.from(document.querySelectorAll('.profile-row')) as HTMLElement[];
    row0.dispatchEvent(dragEv('dragstart'));
    await tick();
    row1.dispatchEvent(dragEv('dragover'));
    await tick();
    row0.dispatchEvent(dragEv('dragend'));
    await tick();
    expect(row1.classList.contains('drag-over')).toBe(false);
  });

  it('Cancel in save confirmation dismisses confirmation without saving', async () => {
    const { saveProfile } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    await fireEvent.click(screen.getByTitle('Save current layout to this profile'));
    await fireEvent.click(screen.getByText('Cancel'));
    expect(saveProfile).not.toHaveBeenCalled();
    expect(screen.queryByText(/Are you sure/)).toBeFalsy();
    expect(screen.getByTitle('Save current layout to this profile')).toBeTruthy();
  });

  it('pressing Enter in footer input calls saveAs', async () => {
    const { saveAs } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const input = screen.getByPlaceholderText(/profile name/i);
    await fireEvent.input(input, { target: { value: 'Enter Layout' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(saveAs).toHaveBeenCalledWith('Enter Layout');
  });

  it('pressing Enter in footer input with empty value does not call saveAs', async () => {
    const { saveAs } = await import('../../lib/state/profileStore.svelte');
    await renderModal();
    const input = screen.getByPlaceholderText(/profile name/i);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('delete button click on only profile does not call deleteProfile', async () => {
    const { deleteProfile, getProfileList } = await import('../../lib/state/profileStore.svelte');
    vi.mocked(getProfileList).mockReturnValue([{ id: 'default', name: 'Default' }]);
    await renderModal();
    const deleteBtn = screen.getByLabelText(/delete default/i) as HTMLButtonElement;
    // Button is disabled — clicking it should not invoke deleteProfile
    await fireEvent.click(deleteBtn);
    expect(deleteProfile).not.toHaveBeenCalled();
  });
});
