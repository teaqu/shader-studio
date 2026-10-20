import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import EditorToolbar from '../../lib/components/EditorToolbar.svelte';
import { configureHost, resetHost } from '../../lib/state/hostState.svelte';
import { getFixturePreferences, setFixturePreferences } from '../editor/editorPreferencesFixture.svelte';

afterEach(() => {
  cleanup(); resetHost();
});

it('starts collapsed, expands on demand, and closes the menu when collapsed again', async () => {
  const view = render(EditorToolbar, { touch: true, onCommand: vi.fn() });
  const show = view.getByRole('button', { name: 'Show keyboard toolbar' });
  expect(show).toHaveAttribute('aria-expanded', 'false');
  expect(view.queryByRole('button', { name: 'Indent' })).toBeNull();
  expect(view.getByRole('toolbar')).toHaveClass('collapsed');
  expect(await fireEvent.mouseDown(show)).toBe(false);
  const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  show.dispatchEvent(pointer);
  expect(pointer.defaultPrevented).toBe(false);
  await fireEvent.click(show);
  expect(view.getByRole('button', { name: 'Hide keyboard toolbar' })).toHaveAttribute('aria-expanded', 'true');
  expect(view.getByRole('button', { name: 'Indent' })).toBeTruthy();
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  await fireEvent.click(view.getByRole('button', { name: 'Hide keyboard toolbar' }));
  expect(view.queryByRole('group', { name: 'More editing options' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Indent' })).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  expect(view.getByRole('button', { name: 'More editing options' })).toHaveAttribute('aria-expanded', 'false');
});

it('toggles mobile navigation from More without closing the menu', async () => {
  setFixturePreferences({ ...getFixturePreferences(), mobileNavigation: true });
  configureHost({
    getEditorPreferences: getFixturePreferences,
    setEditorMobileNavigation: enabled => setFixturePreferences({ ...getFixturePreferences(), mobileNavigation: enabled }),
  });
  const view = render(EditorToolbar, { touch: true, onCommand: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  const hide = view.getByRole('button', { name: 'Hide Editor and Preview tabs' });
  expect(hide).toHaveAttribute('aria-pressed', 'true');
  expect(await fireEvent.mouseDown(hide)).toBe(false);
  await fireEvent.click(hide);
  expect(getFixturePreferences().mobileNavigation).toBe(false);
  const show = view.getByRole('button', { name: 'Show Editor and Preview tabs' });
  expect(show).toHaveAttribute('aria-pressed', 'false');
  await fireEvent.click(show);
  expect(getFixturePreferences().mobileNavigation).toBe(true);
  expect(view.getByRole('group', { name: 'More editing options' })).toBeVisible();
});

it('toggles the shader backdrop from the mobile keys menu', async () => {
  setFixturePreferences({ ...getFixturePreferences(), mobileShaderBackdrop: false });
  configureHost({
    getEditorPreferences: getFixturePreferences,
    setEditorMobileShaderBackdrop: enabled => setFixturePreferences({ ...getFixturePreferences(), mobileShaderBackdrop: enabled }),
  });
  const view = render(EditorToolbar, { touch: true, onCommand: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  const show = view.getByRole('button', { name: 'Show shader behind text' });
  expect(show).toHaveAttribute('aria-pressed', 'false');
  expect(await fireEvent.mouseDown(show)).toBe(false);
  await fireEvent.click(show);
  expect(getFixturePreferences().mobileShaderBackdrop).toBe(true);
  await fireEvent.click(view.getByRole('button', { name: 'Hide shader behind text' }));
  expect(getFixturePreferences().mobileShaderBackdrop).toBe(false);
});

it('toggles mobile descriptions independently from suggestions and desktop descriptions', async () => {
  setFixturePreferences({ ...getFixturePreferences(), mobileDescriptions: false, desktopDescriptions: true, autoSuggestions: true });
  const setter = vi.fn((mobile: boolean, enabled: boolean) => {
    setFixturePreferences({ ...getFixturePreferences(), [mobile ? 'mobileDescriptions' : 'desktopDescriptions']: enabled });
  });
  configureHost({ getEditorPreferences: getFixturePreferences, setEditorDescriptions: setter });
  const view = render(EditorToolbar, { touch: true, onCommand: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  const enable = view.getByRole('button', { name: 'Enable descriptions' });
  expect(enable).toHaveAttribute('aria-pressed', 'false');
  expect(await fireEvent.mouseDown(enable)).toBe(false);
  await fireEvent.click(enable);
  expect(setter).toHaveBeenLastCalledWith(true, true);
  expect(view.getByRole('button', { name: 'Disable descriptions' })).toHaveAttribute('aria-pressed', 'true');
  await fireEvent.click(view.getByRole('button', { name: 'Disable descriptions' }));
  expect(setter).toHaveBeenLastCalledWith(true, false);
  expect(getFixturePreferences()).toMatchObject({ desktopDescriptions: true, autoSuggestions: true });
});
it('renders host controls in one toolbar and hides unused keyboard controls on desktop', async () => {
  const options = createRawSnippet(() => ({ render: () => '<button type="button">Host option</button>' }));
  const view = render(EditorToolbar, { options });
  expect(view.getByRole('toolbar', { name: 'Editor options' })).toContainElement(view.getByRole('button', { name: 'Host option' }));
  expect(view.queryByRole('button', { name: 'More editing options' })).toBeNull();
  await view.rerender({ options: undefined });
  expect(view.queryByRole('toolbar')).toBeNull();
  await view.rerender({ touch: true });
  expect(view.queryByRole('toolbar')).toBeNull();
});

it('shows host options inside More on mobile and directly on desktop', async () => {
  const options = createRawSnippet(() => ({ render: () => '<button type="button">Wrap</button>' }));
  const view = render(EditorToolbar, { options, touch: true, onCommand: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  expect(view.queryByRole('button', { name: 'Wrap' })).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  expect(view.getByRole('group', { name: 'More editing options' }))
    .toContainElement(view.getByRole('button', { name: 'Wrap' }));
  await view.rerender({ touch: false });
  expect(view.getByRole('button', { name: 'Wrap' })).toBeVisible();
});

it('shows keys in one row, keeps options separate, and dispatches commands without suppressing touch clicks', async () => {
  const onCommand = vi.fn();
  const onInsert = vi.fn();
  const view = render(EditorToolbar, { touch: true, onCommand, onInsert });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  const keyboard = view.getByRole('button', { name: 'More editing options' });
  expect(keyboard).toHaveAttribute('aria-expanded', 'false');
  expect(view.queryByRole('group', { name: 'More editing options' })).toBeNull();
  expect(view.getByRole('button', { name: 'Insert ;' })).toBeTruthy();
  const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  keyboard.dispatchEvent(pointer);
  expect(pointer.defaultPrevented).toBe(false);
  expect(await fireEvent.mouseDown(keyboard)).toBe(false);
  await fireEvent.click(keyboard);
  const tools = view.getByRole('group', { name: 'More editing options' });
  expect(keyboard).toHaveAttribute('aria-controls', tools.id);
  expect(keyboard).toHaveAttribute('aria-expanded', 'true');

  expect(view.queryByRole('button', { name: 'Search code' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Compile shader' })).toBeNull();
  for (const [label, command] of [['Undo', 'undo'], ['Redo', 'redo'], ['Indent', 'indent'], ['Outdent', 'outdent']]) {
    const button = view.getByRole('button', { name: label });
    expect(await fireEvent.mouseDown(button)).toBe(false);
    await fireEvent.click(button);
    expect(onCommand).toHaveBeenLastCalledWith(command);
  }
  for (const symbol of ['(', ')', '{', '}', '[', ']', ';', '=']) {
    const button = view.getByRole('button', { name: `Insert ${symbol}` });
    expect(await fireEvent.mouseDown(button)).toBe(false);
    await fireEvent.click(button);
    expect(onInsert).toHaveBeenLastCalledWith(symbol);
  }
  await fireEvent.click(keyboard);
  expect(view.queryByRole('group', { name: 'More editing options' })).toBeNull();
  await fireEvent.click(keyboard);
  await fireEvent.pointerDown(view.getByRole('button', { name: 'Insert ;' }));
  expect(keyboard).toHaveAttribute('aria-expanded', 'true');
  await fireEvent.pointerDown(document.body);
  expect(keyboard).toHaveAttribute('aria-expanded', 'false');
});

it('closes options on Escape and when leaving touch mode, without needing an insertion handler', async () => {
  const onCommand = vi.fn();
  const view = render(EditorToolbar, { touch: true, onCommand });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  const keyboard = view.getByRole('button', { name: 'More editing options' });
  await fireEvent.click(keyboard);
  await fireEvent.click(view.getByRole('button', { name: 'Insert ;' }));
  await fireEvent.keyDown(window, { key: 'a' });
  expect(keyboard).toHaveAttribute('aria-expanded', 'true');
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(keyboard).toHaveAttribute('aria-expanded', 'false');
  await fireEvent.click(keyboard);
  await view.rerender({ touch: false });
  expect(view.queryByRole('group', { name: 'More editing options' })).toBeNull();
  await view.rerender({ touch: true });
  expect(view.getByRole('button', { name: 'Show keyboard toolbar' })).toHaveAttribute('aria-expanded', 'false');
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  expect(view.getByRole('button', { name: 'More editing options' })).toHaveAttribute('aria-expanded', 'false');
});

it('toggles the shared automatic suggestions preference and dismisses the on-screen keyboard', async () => {
  setFixturePreferences({ ...getFixturePreferences(), autoSuggestions: true });
  const setSuggestions = vi.fn((enabled: boolean) => setFixturePreferences({ ...getFixturePreferences(), autoSuggestions: enabled }));
  configureHost({ getEditorPreferences: getFixturePreferences, setEditorAutoSuggestions: setSuggestions });
  const view = render(EditorToolbar, { touch: true, onCommand: vi.fn() });
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  expect(view.getByRole('button', { name: 'Disable suggestions' })).toHaveAttribute('aria-pressed', 'true');
  await fireEvent.click(view.getByRole('button', { name: 'Disable suggestions' }));
  expect(setSuggestions).toHaveBeenLastCalledWith(false);
  expect(view.getByRole('button', { name: 'Enable suggestions' })).toHaveAttribute('aria-pressed', 'false');
  await fireEvent.click(view.getByRole('button', { name: 'Enable suggestions' }));
  expect(setSuggestions).toHaveBeenLastCalledWith(true);
  const input = document.body.appendChild(document.createElement('textarea'));
  input.focus();
  await fireEvent.click(view.getByRole('button', { name: 'Hide keyboard' }));
  expect(document.activeElement).not.toBe(input);
  expect(view.getByRole('button', { name: 'More editing options' })).toHaveAttribute('aria-expanded', 'false');
  input.remove();
});
