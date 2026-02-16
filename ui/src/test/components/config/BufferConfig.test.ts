import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BufferConfig from '../../../lib/components/config/BufferConfig.svelte';
import type { BufferPass, ImagePass } from '@shader-studio/types';

describe('BufferConfig', () => {
  let mockOnUpdate: ReturnType<typeof vi.fn>;
  let mockGetWebviewUri: ReturnType<typeof vi.fn>;
  let mockOnCreateFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnUpdate = vi.fn();
    mockGetWebviewUri = vi.fn();
    mockOnCreateFile = vi.fn();
  });

  describe('Create File Button', () => {
    it('should show create file button when path is empty and suggestedPath provided', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(getByText('Create myshader.buffera.glsl')).toBeTruthy();
      // Path input should also be visible alongside the create button
      expect(container.querySelector('.config-input')).toBeTruthy();
    });

    it('should not show create file button when path has a value', () => {
      const config: BufferPass = { path: 'existing.glsl', inputs: {} };

      const { queryByText, getByDisplayValue } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(queryByText('Create myshader.buffera.glsl')).toBeNull();
      expect(getByDisplayValue('existing.glsl')).toBeTruthy();
    });

    it('should not show create file button for Image pass', () => {
      const config: ImagePass = { inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        isImagePass: true,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.image.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should call onCreateFile when create button is clicked', async () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.buffera.glsl'
      });

      await fireEvent.click(getByText('Create myshader.buffera.glsl'));
      expect(mockOnCreateFile).toHaveBeenCalledWith('BufferA');
    });

    it('should not show create file button when no suggestedPath', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: ''
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should not show create file button when no onCreateFile handler', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should show path input instead of create button for common buffer with existing path', () => {
      const config: BufferPass = { path: 'myshader.common.glsl', inputs: {} };

      const { getByDisplayValue, queryByText } = render(BufferConfig, {
        bufferName: 'common',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.common.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
      expect(getByDisplayValue('myshader.common.glsl')).toBeTruthy();
    });
  });

  describe('Channel Grid', () => {
    it('should show channels grid for regular buffers', () => {
      const config: BufferPass = { path: 'buffer.glsl', inputs: {} };

      const { getAllByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(getAllByText(/iChannel/)).toHaveLength(4);
    });

    it('should not show channels grid for common buffer', () => {
      const config: BufferPass = { path: 'common.glsl', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'common',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(queryByText('iChannel0')).toBeNull();
    });
  });
});
