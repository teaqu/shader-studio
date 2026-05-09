import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('../../lib/state/profileStore.svelte', () => ({
  getActiveProfile: vi.fn(() => 'default'),
  getProfileList: vi.fn(() => [
    { id: 'default', name: 'Default' },
    { id: 'wide-editor', name: 'Wide editor' },
  ]),
  switchTo: vi.fn(),
  saveAs: vi.fn(),
  renameProfile: vi.fn(),
  deleteProfile: vi.fn(),
}));

describe('ProfileModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
