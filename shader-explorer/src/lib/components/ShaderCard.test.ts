import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ShaderCard from './ShaderCard.svelte';
import type { ShaderFile } from '../types/ShaderFile';

vi.mock('./ShaderPreview.svelte', () => ({
  default: () => '',
}));

const shader: ShaderFile = {
  name: 'ocean.glsl',
  path: '/workspace/ocean.glsl',
  relativePath: 'shaders/ocean.glsl',
  hasConfig: false,
  createdTime: Date.UTC(2026, 7, 1, 10, 30),
  modifiedTime: Date.UTC(2026, 7, 2, 11, 45),
};

describe('ShaderCard context menu', () => {
  it('renders outside the dock container and removes the menu on unmount', async () => {
    const { container, unmount } = render(ShaderCard, {
      props: { shader, vscodeApi: { postMessage: vi.fn() } },
    });
    await fireEvent.contextMenu(container.querySelector('.shader-card')!);
    const menu = document.querySelector('.context-menu')!;
    expect(menu.parentElement).toBe(document.body);
    unmount();
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it.each(['escape', 'outside click', 'delete'])('closes the menu on %s', async (action) => {
    const vscodeApi = { postMessage: vi.fn() };
    const { container } = render(ShaderCard, { props: { shader, vscodeApi } });
    await fireEvent.contextMenu(container.querySelector('.shader-card')!);
    if (action === 'escape') {
      await fireEvent.keyDown(window, { key: 'Escape' });
    } else if (action === 'outside click') {
      await fireEvent.click(document.body);
    } else {
      await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(vscodeApi.postMessage).toHaveBeenCalledWith({ type: 'deleteShader', path: shader.path });
    }
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('shows full timestamps and sends a rename request', async () => {
    const vscodeApi = { postMessage: vi.fn() };
    const { container } = render(ShaderCard, { props: { shader, vscodeApi } });

    await fireEvent.contextMenu(container.querySelector('.shader-card')!, {
      clientX: 40,
      clientY: 60,
    });

    expect(screen.getByText(/^Created/)).toBeVisible();
    expect(screen.getByText(/^Last modified/)).toBeVisible();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'renameShader',
      path: shader.path,
    });
  });

  it('closes the previous menu when another shader is right-clicked', async () => {
    const vscodeApi = { postMessage: vi.fn() };
    const first = render(ShaderCard, { props: { shader, vscodeApi } });
    const second = render(ShaderCard, {
      props: {
        shader: { ...shader, name: 'sky.glsl', path: '/workspace/sky.glsl' },
        vscodeApi,
      },
    });

    await fireEvent.contextMenu(first.container.querySelector('.shader-card')!);
    await fireEvent.contextMenu(second.container.querySelector('.shader-card')!);

    expect(document.querySelectorAll('.context-menu')).toHaveLength(1);
  });

  it('initially anchors the menu at the right-click position', async () => {
    const vscodeApi = { postMessage: vi.fn() };
    const { container } = render(ShaderCard, { props: { shader, vscodeApi } });

    await fireEvent.contextMenu(container.querySelector('.shader-card')!, {
      clientX: window.innerWidth - 1,
      clientY: window.innerHeight - 1,
    });

    const menu = document.querySelector('.context-menu') as HTMLElement;
    expect(menu.style.left).toBe(`${window.innerWidth - 1}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 1}px`);
  });
});
