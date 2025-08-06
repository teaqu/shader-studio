import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ConfigEditor from '../lib/components/ConfigEditor.svelte';
import { simulateVSCodeMessage, createMockConfig, createMockError } from './setup';
import type { ShaderConfig } from '../lib/types/ShaderConfig';

// Import test fixtures
import simpleConfig from './fixtures/simple-config.json';
import complexConfig from './fixtures/complex-config.json';
import minimalConfig from './fixtures/minimal-config.json';

describe('ConfigEditor Integration Tests', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state initially', () => {
    render(ConfigEditor);

    expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
    expect(screen.getByText('Shader Configuration')).toBeInTheDocument();
  });

  it('should display error message when config loading fails', async () => {
    render(ConfigEditor);
    
    simulateVSCodeMessage(createMockError('Failed to load configuration file'));
    
    await waitFor(() => {
      expect(screen.getByText('Error:')).toBeInTheDocument();
      expect(screen.getByText('Failed to load configuration file')).toBeInTheDocument();
    });
  }); 
  
  it('should display simple config correctly', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(simpleConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByText('Shader Configuration')).toBeInTheDocument();

      const imageButton = screen.getByRole('button', { name: 'Image' });
      expect(imageButton).toBeInTheDocument();
      expect(imageButton).toHaveClass('active');

      expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument();
    });
  });

  it('should display complex config with multiple buffers', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(complexConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BufferB' })).toBeInTheDocument();

      expect(screen.getByRole('button', { name: 'Image' })).toHaveClass('active');

      const bufferRemoveButtons = screen.getAllByTitle(/Remove Buffer/);
      expect(bufferRemoveButtons).toHaveLength(2);
    });
  });

  it('should switch tabs correctly', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(complexConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'BufferA' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'BufferA' })).toHaveClass('active');
      expect(screen.getByRole('button', { name: 'Image' })).not.toHaveClass('active');
    });

    await user.click(screen.getByRole('button', { name: 'Image' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toHaveClass('active');
      expect(screen.getByRole('button', { name: 'BufferA' })).not.toHaveClass('active');
    });
  });

  it('should display minimal config correctly', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(minimalConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      const tabButtons = screen.getAllByRole('button').filter(btn =>
        btn.className.includes('tab-button') &&
        (btn.textContent === 'BufferA' || btn.textContent === 'BufferB' || btn.textContent === 'BufferC' || btn.textContent === 'BufferD')
      );
      expect(tabButtons).toHaveLength(0);

      expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument();
    });
  });

  it('should handle VS Code API communication', async () => {
    const mockPostMessage = vi.fn();
    (global as any).acquireVsCodeApi = vi.fn(() => ({
      postMessage: mockPostMessage,
      getState: vi.fn(),
      setState: vi.fn()
    }));

    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(simpleConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
    });

    expect(screen.getByText('Shader Configuration')).toBeInTheDocument();
  });

  it('should validate config structure matches expected schema', async () => {
    render(ConfigEditor);

    const testConfig = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {
            iChannel0: {
              type: "texture",
              path: "./test.png"
            }
          }
        },
        BufferA: {
          path: "./buffer.glsl",
          inputs: {
            iChannel0: {
              type: "keyboard"
            }
          }
        }
      }
    };

    simulateVSCodeMessage(createMockConfig(testConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();

      expect(screen.queryByText('Error:')).not.toBeInTheDocument();
    });
  });

  describe('Texture Configuration Tests', () => {
    it('should handle clearing texture path and result in empty string', async () => {
      const mockPostMessage = vi.fn();
      (global as any).acquireVsCodeApi = vi.fn(() => ({
        postMessage: mockPostMessage,
        getState: vi.fn(),
        setState: vi.fn()
      }));

      render(ConfigEditor);

      const testConfig = {
        version: "1.0",
        passes: {
          Image: {
            inputs: {
              iChannel0: {
                type: "texture",
                path: "./textures/test.png"
              }
            }
          }
        }
      };

      simulateVSCodeMessage(createMockConfig(testConfig as ShaderConfig));

      await waitFor(() => {
        expect(screen.getByLabelText(/Path/)).toBeInTheDocument();
      });

      const pathInput = screen.getByLabelText(/Path/) as HTMLInputElement;
      expect(pathInput.value).toBe('./textures/test.png');

      // Clear the path
      await user.clear(pathInput);

      await waitFor(() => {
        expect(pathInput.value).toBe('');
      });

      // Verify the config was updated with empty string
      await waitFor(() => {
        expect(mockPostMessage).toHaveBeenCalled();
        const lastCall = mockPostMessage.mock.calls[mockPostMessage.mock.calls.length - 1];
        expect(lastCall[0]).toEqual(
          expect.objectContaining({
            type: 'updateConfig',
            text: expect.stringContaining('"path": ""')
          })
        );
      });
    });

    it('should handle complete texture configuration workflow', async () => {
      const mockPostMessage = vi.fn();
      (global as any).acquireVsCodeApi = vi.fn(() => ({
        postMessage: mockPostMessage,
        getState: vi.fn(),
        setState: vi.fn()
      }));

      render(ConfigEditor);

      // Start with minimal config
      const testConfig = {
        version: "1.0",
        passes: {
          Image: {
            inputs: {}
          }
        }
      };

      simulateVSCodeMessage(createMockConfig(testConfig as ShaderConfig));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      });

      // Add texture channel
      const addChannelButton = screen.getByText('+ Add Channel');
      await user.click(addChannelButton);
      await user.click(screen.getByText('iChannel0'));

      // Set to texture type
      const typeSelect = screen.getByLabelText(/Type/) as HTMLSelectElement;
      await user.selectOptions(typeSelect, 'texture');

      await waitFor(() => {
        expect(screen.getByLabelText(/Path/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Filter/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Wrap/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Vertical Flip/)).toBeInTheDocument();
      });

      // Configure all texture properties
      const pathInput = screen.getByLabelText(/Path/) as HTMLInputElement;
      const filterSelect = screen.getByLabelText(/Filter/) as HTMLSelectElement;
      const wrapSelect = screen.getByLabelText(/Wrap/) as HTMLSelectElement;
      const vflipCheckbox = screen.getByLabelText(/Vertical Flip/) as HTMLInputElement;

      await user.type(pathInput, './textures/complete-test.jpg');
      await user.selectOptions(filterSelect, 'linear');
      await user.selectOptions(wrapSelect, 'clamp');
      
      // vflip should be checked by default, so uncheck it
      if (vflipCheckbox.checked) {
        await user.click(vflipCheckbox);
      }

      await waitFor(() => {
        expect(pathInput.value).toBe('./textures/complete-test.jpg');
        expect(filterSelect.value).toBe('linear');
        expect(wrapSelect.value).toBe('clamp');
        expect(vflipCheckbox.checked).toBe(false);
      });

      // Verify final configuration contains all properties
      await waitFor(() => {
        const lastCall = mockPostMessage.mock.calls[mockPostMessage.mock.calls.length - 1];
        const configText = lastCall[0].text;
        expect(configText).toContain('./textures/complete-test.jpg');
        expect(configText).toContain('"filter": "linear"');
        expect(configText).toContain('"wrap": "clamp"');
        expect(configText).toContain('"vflip": false');
      });
    });

    it('should test texture configuration in BufferA pass', async () => {
      const mockPostMessage = vi.fn();
      (global as any).acquireVsCodeApi = vi.fn(() => ({
        postMessage: mockPostMessage,
        getState: vi.fn(),
        setState: vi.fn()
      }));

      render(ConfigEditor);

      const testConfig = {
        version: "1.0",
        passes: {
          Image: {},
          BufferA: {
            path: "./buffer.glsl",
            inputs: {
              iChannel0: {
                type: "texture",
                path: "./textures/buffer-texture.png",
                filter: "nearest",
                wrap: "repeat",
                vflip: false
              }
            }
          }
        }
      };

      simulateVSCodeMessage(createMockConfig(testConfig as ShaderConfig));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();
      });

      // Switch to BufferA tab
      await user.click(screen.getByRole('button', { name: 'BufferA' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'BufferA' })).toHaveClass('active');
        // Use specific IDs to avoid ambiguity with multiple path inputs
        expect(screen.getByLabelText('Path:', { selector: 'input[id="path-BufferA"]' })).toBeInTheDocument();
      });

      // Find texture-specific inputs by their specific IDs
      const bufferPathInput = screen.getByLabelText('Path:', { selector: 'input[id="path-BufferA"]' }) as HTMLInputElement;
      const texturePathInput = screen.getByLabelText('Path:', { selector: 'input[id="path-iChannel0"]' }) as HTMLInputElement;
      expect(texturePathInput.value).toBe('./textures/buffer-texture.png');

      const filterSelect = screen.getByLabelText(/Filter/) as HTMLSelectElement;
      const wrapSelect = screen.getByLabelText(/Wrap/) as HTMLSelectElement;
      const vflipCheckbox = screen.getByLabelText(/Vertical Flip/) as HTMLInputElement;

      // Verify initial values
      expect(texturePathInput.value).toBe('./textures/buffer-texture.png');
      expect(filterSelect.value).toBe('nearest');
      expect(wrapSelect.value).toBe('repeat');
      expect(vflipCheckbox.checked).toBe(false);

      // Update texture path to empty string
      await user.clear(texturePathInput);

      await waitFor(() => {
        expect(texturePathInput.value).toBe('');
      });

      // Verify empty path is reflected in JSON
      await waitFor(() => {
        const lastCall = mockPostMessage.mock.calls[mockPostMessage.mock.calls.length - 1];
        expect(lastCall[0]).toEqual(
          expect.objectContaining({
            type: 'updateConfig',
            text: expect.stringContaining('"path": ""')
          })
        );
      });
    });
  });
});
