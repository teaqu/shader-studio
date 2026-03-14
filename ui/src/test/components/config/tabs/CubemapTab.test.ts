import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import CubemapTab from '../../../../lib/components/config/tabs/CubemapTab.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('CubemapTab', () => {
  const defaultProps = () => ({
    tempInput: { type: 'cubemap', path: '' } as ConfigInput | undefined,
    channelName: 'iChannel0',
    shaderPath: '/test/shader.glsl',
    postMessage: vi.fn(),
    onMessage: undefined as ((handler: (event: MessageEvent) => void) => void) | undefined,
    onAssetSelect: vi.fn(),
    onUpdatePath: vi.fn(),
    onUpdateFilter: vi.fn(),
    onUpdateWrap: vi.fn(),
    onUpdateVFlip: vi.fn(),
  });

  describe('Rendering', () => {
    it('should render path input with cubemap placeholder', () => {
      render(CubemapTab, defaultProps());

      expect(screen.getByPlaceholderText('Path to cubemap cross-pattern PNG')).toBeInTheDocument();
    });

    it('should render filter and wrap selects', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      expect(screen.getByLabelText('Filter:')).toBeInTheDocument();
      expect(screen.getByLabelText('Wrap:')).toBeInTheDocument();
    });

    it('should render vflip checkbox', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      expect(screen.getByLabelText('Vertical Flip')).toBeInTheDocument();
    });

    it('should NOT render grayscale checkbox (unlike texture)', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      expect(screen.queryByLabelText('Grayscale')).not.toBeInTheDocument();
    });

    it('should display existing path value', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './existing-cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./existing-cubemap.png');
    });
  });

  describe('Default values', () => {
    it('should default filter to mipmap', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      expect(filterSelect.value).toBe('mipmap');
    });

    it('should default wrap to clamp (different from texture)', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      expect(wrapSelect.value).toBe('clamp');
    });

    it('should default vflip to false (different from texture)', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      expect(vflipCheckbox.checked).toBe(false);
    });
  });

  describe('Callbacks', () => {
    it('should call onUpdatePath when path changes', async () => {
      const props = defaultProps();
      render(CubemapTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './new-cubemap.png' } });

      expect(props.onUpdatePath).toHaveBeenCalledWith('./new-cubemap.png');
    });

    it('should call onUpdateFilter when filter changes', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      expect(props.onUpdateFilter).toHaveBeenCalledWith('nearest');
    });

    it('should call onUpdateWrap when wrap changes', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png' } as ConfigInput,
      };

      render(CubemapTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'repeat' } });

      expect(props.onUpdateWrap).toHaveBeenCalledWith('repeat');
    });

    it('should call onUpdateVFlip when vflip toggled', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'cubemap', path: './cubemap.png', vflip: false } as ConfigInput,
      };

      render(CubemapTab, props);

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      await fireEvent.click(vflipCheckbox);

      expect(props.onUpdateVFlip).toHaveBeenCalledWith(true);
    });
  });
});
