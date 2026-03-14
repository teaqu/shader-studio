import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import TextureTab from '../../../../lib/components/config/tabs/TextureTab.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('TextureTab', () => {
  const defaultProps = () => ({
    tempInput: { type: 'texture', path: '' } as ConfigInput | undefined,
    channelName: 'iChannel0',
    shaderPath: '/test/shader.glsl',
    postMessage: vi.fn(),
    onMessage: undefined as ((handler: (event: MessageEvent) => void) => void) | undefined,
    onAssetSelect: vi.fn(),
    onUpdatePath: vi.fn(),
    onUpdateFilter: vi.fn(),
    onUpdateWrap: vi.fn(),
    onUpdateVFlip: vi.fn(),
    onUpdateGrayscale: vi.fn(),
  });

  describe('Rendering', () => {
    it('should render path input', () => {
      render(TextureTab, defaultProps());

      const pathInput = screen.getByLabelText('Path:');
      expect(pathInput).toBeInTheDocument();
    });

    it('should render filter and wrap selects when texture input exists', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      expect(screen.getByLabelText('Filter:')).toBeInTheDocument();
      expect(screen.getByLabelText('Wrap:')).toBeInTheDocument();
    });

    it('should render vflip and grayscale checkboxes', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      expect(screen.getByLabelText('Vertical Flip')).toBeInTheDocument();
      expect(screen.getByLabelText('Grayscale')).toBeInTheDocument();
    });

    it('should display path placeholder', () => {
      render(TextureTab, defaultProps());

      expect(screen.getByPlaceholderText('Path to texture file')).toBeInTheDocument();
    });

    it('should display existing path value', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './existing.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./existing.png');
    });
  });

  describe('Default values', () => {
    it('should default filter to mipmap', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      expect(filterSelect.value).toBe('mipmap');
    });

    it('should default wrap to repeat', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      expect(wrapSelect.value).toBe('repeat');
    });

    it('should default vflip to true', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      expect(vflipCheckbox.checked).toBe(true);
    });

    it('should default grayscale to false', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const grayscaleCheckbox = screen.getByLabelText('Grayscale') as HTMLInputElement;
      expect(grayscaleCheckbox.checked).toBe(false);
    });
  });

  describe('Callbacks', () => {
    it('should call onUpdatePath when path changes', async () => {
      const props = defaultProps();
      render(TextureTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './new-texture.png' } });

      expect(props.onUpdatePath).toHaveBeenCalledWith('./new-texture.png');
    });

    it('should call onUpdateFilter when filter changes', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      expect(props.onUpdateFilter).toHaveBeenCalledWith('nearest');
    });

    it('should call onUpdateWrap when wrap changes', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png' } as ConfigInput,
      };

      render(TextureTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'clamp' } });

      expect(props.onUpdateWrap).toHaveBeenCalledWith('clamp');
    });

    it('should call onUpdateVFlip when vflip toggled', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png', vflip: true } as ConfigInput,
      };

      render(TextureTab, props);

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      await fireEvent.click(vflipCheckbox);

      expect(props.onUpdateVFlip).toHaveBeenCalledWith(false);
    });

    it('should call onUpdateGrayscale when grayscale toggled', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png', grayscale: false } as ConfigInput,
      };

      render(TextureTab, props);

      const grayscaleCheckbox = screen.getByLabelText('Grayscale') as HTMLInputElement;
      await fireEvent.click(grayscaleCheckbox);

      expect(props.onUpdateGrayscale).toHaveBeenCalledWith(true);
    });
  });

  describe('Existing values', () => {
    it('should display existing filter value', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png', filter: 'linear' } as ConfigInput,
      };

      render(TextureTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      expect(filterSelect.value).toBe('linear');
    });

    it('should display existing wrap value', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'texture', path: './test.png', wrap: 'clamp' } as ConfigInput,
      };

      render(TextureTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      expect(wrapSelect.value).toBe('clamp');
    });
  });
});
