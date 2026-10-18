import type { ConfigInput } from '@shader-studio/types';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import SettingsPanel from '../../../../standalone/src/settings/SettingsPanel.svelte';
import { StandaloneSettings } from '../../../../standalone/src/settings/StandaloneSettings';
import ProfileModal from '../../lib/components/ProfileModal.svelte';
import { ktxVolume } from '../../../../types/test/ktxVolume';
import StoragePanel from '../../lib/components/config/StoragePanel.svelte';
import DebugPanel from '../../lib/components/debug/DebugPanel.svelte';
import PerformancePanel from '../../lib/components/performance/PerformancePanel.svelte';
import RecordingPanel from '../../lib/components/recording/RecordingPanel.svelte';
import BufferConfig from '../../lib/components/config/BufferConfig.svelte';
import ChannelConfigModal from '../../lib/components/config/ChannelConfigModal.svelte';
import NewShaderModal from '../../../../standalone/src/NewShaderModal.svelte';
import PathInput from '../../lib/components/config/PathInput.svelte';
import ShaderFileControls from '../../lib/components/config/ShaderFileControls.svelte';
import '../../app.css';
import '../../lib/components/config/configPanel.css';

const mounted: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  for (const component of mounted.splice(0)) {
    await unmount(component);
  }
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  document.body.className = '';
  document.documentElement.removeAttribute('data-theme');
});

function target(className = ''): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  document.body.append(element);
  return element;
}

describe('shared control sizing across viewer and standalone dialogs', () => {
  it.each(['light', 'dark'])('matches forms and actions in the %s theme', async theme => {
    document.documentElement.dataset.theme = theme;
    const config = target('config-panel');
    mounted.push(mount(BufferConfig, { target: config, props: {
      bufferName: 'Image', isImagePass: true,
      config: {}, onUpdate: vi.fn(), getWebviewUri: () => undefined,
    } }));
    const dialog = target();
    mounted.push(mount(NewShaderModal, { target: dialog, props: {
      onCreate: vi.fn(), onClose: vi.fn(),
    } }));
    await expect.poll(() => config.querySelector('select')).not.toBeNull();
    const controls = [
      config.querySelector('select')!,
      config.querySelector<HTMLButtonElement>('.preset-btn')!,
      config.querySelector<HTMLButtonElement>('.add-channel-btn')!,
      dialog.querySelector('input')!,
      dialog.querySelector('select')!,
      dialog.querySelector('button[type="submit"]')!,
    ];
    for (const control of controls) {
      expect(control, 'A representative form control must be mounted').not.toBeNull();
      const style = getComputedStyle(control);
      expect(style.height, control.outerHTML).toBe('26px');
      expect(style.fontSize, control.outerHTML).toBe('13px');
      expect(style.borderTopLeftRadius, control.outerHTML).toBe('4px');
    }
  });

  it('honours the host font and palette, including keyboard focus', async () => {
    document.documentElement.dataset.theme = 'dark';
    document.body.className = 'vscode-high-contrast-light';
    document.body.style.cssText = '--vscode-font-size:14px;--vscode-input-background:#f2f3f4;--vscode-input-foreground:#202122;--vscode-dropdown-background:#e6e7e8;--vscode-dropdown-foreground:#303132;--vscode-focusBorder:#123456';
    const config = target('config-panel');
    mounted.push(mount(BufferConfig, { target: config, props: {
      bufferName: 'Image', isImagePass: true, config: {},
      onUpdate: vi.fn(), getWebviewUri: () => undefined,
    } }));
    await expect.poll(() => config.querySelector('select')).not.toBeNull();
    const select = config.querySelector('select')!;
    const style = getComputedStyle(select);
    expect(style.fontSize).toBe('14px');
    expect(style.backgroundColor).toBe('rgb(230, 231, 232)');
    expect(style.color).toBe('rgb(48, 49, 50)');
    expect(style.colorScheme).toBe('light');
    select.focus();
    expect(getComputedStyle(select).outlineColor).toBe('rgb(18, 52, 86)');
    expect(getComputedStyle(select).outlineStyle).toBe('solid');
  });

  it('gives config and portalled channel tabs the same height', async () => {
    document.documentElement.dataset.theme = 'light';
    const config = target('config-panel');
    const bar = document.createElement('div');
    bar.className = 'tab-navigation';
    const passTab = document.createElement('button');
    passTab.className = 'tab-button active';
    passTab.textContent = 'Image';
    bar.append(passTab);
    config.append(bar);
    mounted.push(mount(ChannelConfigModal, { target: target(), props: {
      isOpen: true, channelName: 'iChannel0', channelInput: { type: 'keyboard' },
      getWebviewUri: () => undefined, onClose: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(),
    } }));
    await expect.poll(() => document.querySelector('.tab-btn')).not.toBeNull();
    const channelTab = document.querySelector('.tab-btn')!;
    expect(getComputedStyle(passTab).height).toBe('35px');
    expect(getComputedStyle(channelTab).height).toBe('35px');
  });

  it('keeps toolbar targets and keyboard focus consistent as panels narrow', () => {
    document.documentElement.dataset.theme = 'light';
    const toolbar = target('menu-bar');
    const group = document.createElement('div');
    group.className = 'left-group';
    const reset = document.createElement('button');
    reset.className = 'toolbar-icon-button';
    reset.textContent = 'Reset';
    group.append(reset);
    toolbar.append(group);
    for (const width of [900, 600, 400]) {
      toolbar.style.width = `${width}px`;
      expect(getComputedStyle(reset).height).toBe('24px');
      expect(getComputedStyle(reset).fontSize).toBe('13px');
    }
    reset.focus();
    expect(getComputedStyle(reset).outlineStyle).toBe('solid');
    expect(getComputedStyle(reset).outlineWidth).toBe('1px');
  });

  it('keeps a path action beside its input when the row has room', async () => {
    const panel = target('config-panel');
    panel.style.width = '380px';
    mounted.push(mount(PathInput, { target: panel, props: {
      value: 'passes/blur.glsl', label: 'File', selectLabel: 'Change…',
      allowCreate: false, postMessage: vi.fn(), note: 'Shared by two passes',
    } }));
    await expect.poll(() => panel.querySelector('input')).not.toBeNull();
    const input = panel.querySelector('input')!.getBoundingClientRect();
    const button = panel.querySelector('button')!.getBoundingClientRect();
    expect(button.top).toBe(input.top);
    expect(button.right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
    expect(panel.querySelector('.input-note')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(input.bottom);
  });

  it('keeps file selection and Open editor together in a narrow panel', async () => {
    const panel = target('config-panel');
    panel.style.width = '260px';
    mounted.push(mount(ShaderFileControls, { target: panel, props: {
      value: './passes/long-shared-buffer-name.wgsl', shaderPath: '/image.wgsl',
      language: 'wgsl', fileType: 'wgsl-buffer', suggestedPath: 'buffer.wgsl',
      inputId: 'test-source', summary: true, onOpen: vi.fn(),
      onPathChange: vi.fn(), onCreated: vi.fn(),
    } }));
    await expect.poll(() => panel.querySelector('.picker-button')).not.toBeNull();
    const file = panel.querySelector('.picker-button')!.getBoundingClientRect();
    const open = panel.querySelector('.open-editor-btn')!.getBoundingClientRect();
    expect(open.top).toBe(file.top);
    expect(open.right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
  });

  it('keeps Reset with its resolution row while presets wrap inside their group', async () => {
    const panel = target('config-panel');
    panel.style.width = '260px';
    mounted.push(mount(BufferConfig, { target: panel, props: {
      bufferName: 'Image', isImagePass: true, config: {},
      onUpdate: vi.fn(), getWebviewUri: () => undefined,
    } }));
    await expect.poll(() => panel.querySelector('.reset-btn')).not.toBeNull();
    const presets = panel.querySelector('.resolution-section .preset-buttons')!.getBoundingClientRect();
    const reset = panel.querySelector('.reset-btn')!.getBoundingClientRect();
    expect(reset.top).toBe(presets.top);
    expect(reset.right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
  });
  it.each(['texture', 'volume', 'cubemap', 'video', 'audio'] as const)('keeps the %s path field and Select together at narrow widths', async type => {
    mounted.push(mount(ChannelConfigModal, { target: target(), props: {
      isOpen: true, channelName: 'iChannel0', channelInput: { type, path: '' },
      getWebviewUri: () => undefined, postMessage: vi.fn(),
      onClose: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(),
    } }));
    await expect.poll(() => document.querySelector('.modal-body .config-input')).not.toBeNull();
    const modal = document.querySelector<HTMLElement>('.modal-content')!;
    for (const width of [340, 260]) {
      modal.style.width = `${width}px`;
      const input = modal.querySelector<HTMLInputElement>('.config-input')!;
      const select = modal.querySelector<HTMLButtonElement>('.select-file-btn')!;
      expect(select.getBoundingClientRect().top).toBe(input.getBoundingClientRect().top);
      expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(modal.getBoundingClientRect().right);
      const body = modal.querySelector<HTMLElement>('.modal-body')!;
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    }
  });

  it.each(['Storage', 'Debug', 'Performance', 'Recording'])('keeps %s controls inside a narrow pane', async pane => {
    const panel = target();
    panel.style.cssText = 'width:260px;height:600px';
    if (pane === 'Storage') {
      mounted.push(mount(StoragePanel, { target: panel, props: {
        scope: 'layout-audit', storage: { counter: { count: 4, elementType: 'u32' } },
        referencesFor: () => [], onAdd: () => null, onApply: () => ({}), onDelete: () => ({}),
      } }));
    }
    if (pane === 'Debug') {
      mounted.push(mount(DebugPanel, { target: panel }));
    }
    if (pane === 'Performance') {
      mounted.push(mount(PerformancePanel, { target: panel, props: { active: false } }));
    }
    if (pane === 'Recording') {
      mounted.push(mount(RecordingPanel, { target: panel, props: {
        canvasWidth: 1280, canvasHeight: 720, displayFrameRate: 60,
        onScreenshot: vi.fn(), onRecord: vi.fn(), onCancel: vi.fn(), onStopLive: vi.fn(),
      } }));
    }
    await tick();
    const checkBounds = () => {
      const bounds = panel.getBoundingClientRect();
      for (const control of panel.querySelectorAll('button, input, select')) {
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }
        expect(rect.right, control.outerHTML).toBeLessThanOrEqual(bounds.right + 1);
        expect(rect.left, control.outerHTML).toBeGreaterThanOrEqual(bounds.left - 1);
      }
    };
    checkBounds();
    if (pane === 'Recording') {
      for (const tab of panel.querySelectorAll<HTMLButtonElement>('.tab-button')) {
        tab.click();
        await tick();
        checkBounds();
      }
    }
  });

  it.each(['Settings', 'Profiles', 'New shader', 'Misc'])('fits the %s dialog actions at narrow widths', async pane => {
    const host = target();
    if (pane === 'Settings') {
      mounted.push(mount(SettingsPanel, { target: host, props: {
        settings: new StandaloneSettings({ getItem: () => null, setItem: vi.fn() }), onClose: vi.fn(),
      } }));
    }
    if (pane === 'Profiles') {
      mounted.push(mount(ProfileModal, { target: host, props: { onclose: vi.fn() } }));
    }
    if (pane === 'New shader') {
      mounted.push(mount(NewShaderModal, { target: host, props: { onCreate: vi.fn(), onClose: vi.fn() } }));
    }
    if (pane === 'Misc') {
      mounted.push(mount(ChannelConfigModal, { target: host, props: {
        isOpen: true, channelName: 'iChannel0', channelInput: { type: 'keyboard' },
        getWebviewUri: () => undefined, onClose: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(),
      } }));
    }
    await tick();
    const dialog = document.querySelector<HTMLElement>('dialog, .modal-content')!;
    dialog.style.width = '300px';
    await tick();
    const bounds = dialog.getBoundingClientRect();
    for (const control of dialog.querySelectorAll('input, select, button')) {
      if (control.closest('.tab-bar')) {
        continue;
      }
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      expect(rect.right, control.outerHTML).toBeLessThanOrEqual(bounds.right);
    }
  });

  it('keeps the channel dialog steady across tabs and retains large Misc previews', async () => {
    mounted.push(mount(ChannelConfigModal, { target: target(), props: {
      isOpen: true, channelName: 'iChannel0', channelInput: { type: 'buffer', source: 'BufferA' },
      getWebviewUri: () => undefined, onClose: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(),
    } }));
    await tick();
    const dialog = document.querySelector<HTMLElement>('.modal-content')!;
    const initial = dialog.getBoundingClientRect();
    const buffer = dialog.querySelector<HTMLElement>('.buffer-preview')!;
    expect(getComputedStyle(buffer).backgroundImage).not.toBe('none');
    expect(buffer.getBoundingClientRect().height).toBeGreaterThanOrEqual(64);
    expect(dialog.querySelector('.misc-card')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(96);
    for (const tab of dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      tab.click();
      await tick();
      const rect = dialog.getBoundingClientRect();
      expect(rect.top).toBe(initial.top);
      expect(rect.height).toBe(initial.height);
      const body = dialog.querySelector<HTMLElement>('.modal-body')!;
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    }
  });

  it('places the existing volume preview alongside settings, then stacks it when narrow', async () => {
    await page.viewport(1000, 800);
    const data = btoa(String.fromCharCode(...new Uint8Array(ktxVolume())));
    mounted.push(mount(ChannelConfigModal, { target: target(), props: {
      isOpen: true, channelName: 'iChannel0', channelInput: {
        type: 'volume', path: './noise.ktx2', resolved_path: `data:application/octet-stream;base64,${data}`,
      },
      getWebviewUri: () => undefined, onClose: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(),
    } }));
    await expect.poll(() => document.querySelector('.volume-preview canvas')).not.toBeNull();
    const dialog = document.querySelector<HTMLElement>('.modal-content')!;
    dialog.style.width = '680px';
    const settings = dialog.querySelector<HTMLElement>('.channel-volume-settings')!;
    const preview = dialog.querySelector<HTMLElement>('.channel-preview-section')!;
    expect(preview.getBoundingClientRect().left).toBeGreaterThan(settings.getBoundingClientRect().right);
    expect(preview.getBoundingClientRect().top).toBe(settings.getBoundingClientRect().top);
    dialog.style.width = '300px';
    expect(preview.getBoundingClientRect().top).toBeGreaterThanOrEqual(settings.getBoundingClientRect().bottom);
  });

  it.each([
    { type: 'buffer', source: 'BufferA' },
    { type: 'screen' },
    { type: 'texture', path: '' },
    { type: 'cubemap', path: '' },
    { type: 'video', path: '' },
    { type: 'volume', path: '' },
  ] satisfies ConfigInput[])('uses the shared Sampling layout for $type', async input => {
    await page.viewport(1000, 800);
    mounted.push(mount(ChannelConfigModal, { target: target(), props: {
      isOpen: true, channelName: 'iChannel0', channelInput: input,
      getWebviewUri: () => undefined, onClose: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(),
    } }));
    await tick();
    const dialog = document.querySelector<HTMLElement>('.modal-content')!;
    const fields = dialog.querySelectorAll<HTMLSelectElement>('.sampling-fields select');
    expect(fields.length).toBe(2);
    expect(fields[0].getBoundingClientRect().top).toBe(fields[1].getBoundingClientRect().top);
    expect(fields[0].getBoundingClientRect().width).toBe(fields[1].getBoundingClientRect().width);
    for (const field of fields) {
      const label = [...dialog.querySelectorAll<HTMLLabelElement>('label')].find(item => item.htmlFor === field.id)!;
      expect(label.getBoundingClientRect().bottom).toBeLessThan(field.getBoundingClientRect().top);
      expect(getComputedStyle(field).height).toBe('26px');
      expect(getComputedStyle(label).fontSize).toBe('12px');
    }
    dialog.style.width = '260px';
    expect(fields[1].getBoundingClientRect().top).toBeGreaterThan(fields[0].getBoundingClientRect().bottom);
    const body = dialog.querySelector<HTMLElement>('.modal-body')!;
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
  });

  it('keeps the Built-in authoring mode wide enough to read inside fragment controls', async () => {
    const panel = target('config-panel');
    panel.style.width = '400px';
    const row = document.createElement('div');
    row.className = 'buffer-details';
    row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start';
    panel.append(row);
    mounted.push(mount(PathInput, { target: row, props: {
      value: '', hidePath: true, allowCreate: false, allowSelect: false,
      allowInsert: true, fileType: 'slang-buffer', existingModes: ['hooks'],
      authoringMode: 'hooks', postMessage: vi.fn(),
    } }));
    await tick();
    const mode = panel.querySelector<HTMLSelectElement>('[aria-label="Insert mode"]')!;
    expect(mode.selectedOptions[0].textContent).toBe('Built-in');
    expect(mode.getBoundingClientRect().width).toBeGreaterThanOrEqual(80);
    expect(mode.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
  });

  // Config now lists passes as cards, so the shared panel tab rule is the reference.
  it('gives Export the shared panel tabs, including the active underline', async () => {
    const reference = target('recording-panel');
    reference.innerHTML = '<div class="tab-navigation"><button class="tab-button active">Image</button></div>';
    const recording = target();
    mounted.push(mount(RecordingPanel, { target: recording, props: {
      canvasWidth: 1280, canvasHeight: 720, displayFrameRate: 60,
      onScreenshot: vi.fn(), onRecord: vi.fn(), onCancel: vi.fn(), onStopLive: vi.fn(),
    } }));
    await tick();
    const expected = getComputedStyle(reference.querySelector('.tab-button')!);
    const actual = getComputedStyle(recording.querySelector('.tab-button.active')!);
    for (const property of ['height', 'padding', 'background-color', 'border-bottom-width', 'border-bottom-color', 'color']) {
      expect(actual.getPropertyValue(property), property).toBe(expected.getPropertyValue(property));
    }
    expect(getComputedStyle(recording.querySelector('.tab-navigation')!).gap).toBe(getComputedStyle(reference.querySelector('.tab-navigation')!).gap);
  });

});
