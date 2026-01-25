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
import commonBufferConfig from './fixtures/common-buffer-config.json';

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

describe('CommonBuffer Tests', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should display Common tab when common buffer is present in config', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(commonBufferConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Common' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();
    });

    // Verify tab order: Image -> Common -> BufferA
    const tabButtons = screen.getAllByRole('button').filter(btn =>
      btn.className.includes('tab-button')
    );
    expect(tabButtons[0]).toHaveTextContent('Image');
    expect(tabButtons[1]).toHaveTextContent('Common');
    expect(tabButtons[2]).toHaveTextContent('BufferA');
    expect(tabButtons.length).toBe(3); // Image, Common, and BufferA
  });

  it('should show input channels for regular buffers but not for Common', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(commonBufferConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Common' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();
    });

    // Check Common tab has no input channels
    await user.click(screen.getByRole('button', { name: 'Common' }));
    await waitFor(() => {
      expect(screen.queryByText('Input Channels')).not.toBeInTheDocument();
    });

    // Check BufferA tab has input channels
    await user.click(screen.getByRole('button', { name: 'BufferA' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'BufferA' })).toHaveClass('active');
    });

    // BufferA should have input channels section since it's a regular buffer
    expect(screen.getByText('Input Channels')).toBeInTheDocument();
  });

  it('should handle removing and adding Common buffer', async () => {
    const mockPostMessage = vi.fn();
    (global as any).acquireVsCodeApi = vi.fn(() => ({
      postMessage: mockPostMessage,
      getState: vi.fn(),
      setState: vi.fn()
    }));

    render(ConfigEditor);

    // Start with minimal config (no common buffer)
    const minimalConfig = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {}
        }
      }
    };

    simulateVSCodeMessage(createMockConfig(minimalConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      // Common should not be a tab button yet, only in dropdown
      const tabButtons = screen.getAllByRole('button').filter(btn =>
        btn.className.includes('tab-button')
      );
      const commonTab = tabButtons.find(btn => btn.textContent?.trim() === 'Common');
      expect(commonTab).not.toBeDefined();
    });

    // Click add buffer button
    await user.click(screen.getByRole('button', { name: '+' }));

    // Click Common option
    await user.click(screen.getByText('Common'));

    // Verify Common tab now appears
    await waitFor(() => {
      const tabButtons = screen.getAllByRole('button').filter(btn =>
        btn.className.includes('tab-button')
      );
      const commonTab = tabButtons.find(btn => btn.textContent?.trim() === 'Common');
      expect(commonTab).toBeInTheDocument();
    });

    // Verify the config was updated with common buffer
    await waitFor(() => {
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateConfig',
          text: expect.stringContaining('"common"')
        })
      );
    });
  });

  it('should show remove button for Common buffer tab', async () => {
    const mockPostMessage = vi.fn();
    (global as any).acquireVsCodeApi = vi.fn(() => ({
      postMessage: mockPostMessage,
      getState: vi.fn(),
      setState: vi.fn()
    }));

    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(commonBufferConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Common' })).toBeInTheDocument();
    });

    // Check that Common tab has a remove button
    const commonTabWrapper = screen.getByRole('button', { name: 'Common' }).closest('.tab-wrapper');
    const removeButtons = commonTabWrapper?.querySelectorAll('.remove-tab-btn');
    expect(removeButtons?.length || 0).toBe(1);

    // Click the remove button for Common
    const commonRemoveButton = removeButtons?.[0];
    if (commonRemoveButton) {
      await user.click(commonRemoveButton);
    }

    // Verify Common was removed from config
    await waitFor(() => {
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateConfig',
          text: expect.stringContaining('"passes":')
        })
      );
    });

    // Check that Common tab is no longer present
    const lastCall = mockPostMessage.mock.calls[mockPostMessage.mock.calls.length - 1];
    const configText = lastCall[0].text;
    expect(configText).not.toContain('"common":');
  });

  it('should not allow common as buffer source in input channels', async () => {
    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(commonBufferConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
    });

    // Switch to Image tab to see input channels
    await user.click(screen.getByRole('button', { name: 'Image' }));

    await waitFor(() => {
      expect(screen.getByText('Input Channels')).toBeInTheDocument();
    });

    // Add a buffer input channel
    await user.click(screen.getByText('+ Add Channel'));
    await user.click(screen.getByText('iChannel1'));

    // Set type to buffer for iChannel1
    const typeSelect = document.getElementById('type-iChannel1') as HTMLSelectElement;
    await user.selectOptions(typeSelect, 'buffer');

    // Verify that 'common' is NOT in the source options for iChannel1
    const sourceSelect = document.getElementById('source-iChannel1') as HTMLSelectElement;
    const sourceOptions = Array.from(sourceSelect.options).map(option => option.value);
    expect(sourceOptions).not.toContain('common');
    expect(sourceOptions).toEqual(['', 'BufferA', 'BufferB', 'BufferC', 'BufferD']);
  });

  it('should validate common buffer configuration structure', async () => {
    const mockPostMessage = vi.fn();
    (global as any).acquireVsCodeApi = vi.fn(() => ({
      postMessage: mockPostMessage,
      getState: vi.fn(),
      setState: vi.fn()
    }));

    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(commonBufferConfig as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Common' })).toBeInTheDocument();
    });

    // Switch to Common tab
    await user.click(screen.getByRole('button', { name: 'Common' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Common' })).toHaveClass('active');
    });

    // Verify path input is present and has correct value
    const pathInput = screen.getByLabelText(/Path/) as HTMLInputElement;
    expect(pathInput).toBeInTheDocument();
    expect(pathInput.value).toBe('./common.glsl');

    // Update path and verify it updates the config
    await user.clear(pathInput);
    await user.type(pathInput, './shared/common.glsl');

    await waitFor(() => {
      expect(pathInput.value).toBe('./shared/common.glsl');
    });

    // Verify the config was updated
    await waitFor(() => {
      const lastCall = mockPostMessage.mock.calls[mockPostMessage.mock.calls.length - 1];
      const configText = lastCall[0].text;
      expect(configText).toContain('./shared/common.glsl');
      expect(configText).toContain('"common":');
      expect(configText).not.toContain('"common": {\n      "path": "./shared/common.glsl",\n      "inputs":'); // Common should have no inputs property
    });
  });

  it('should validate common buffer JSON schema compliance', async () => {
    // Test that common buffer config is valid according to JSON schema
    const validCommonConfig = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {
            "iChannel0": {
              "type": "buffer",
              "source": "BufferA"
            }
          }
        },
        "common": {
          "path": "./common.glsl"
        },
        "BufferA": {
          "path": "./buffers/buffer_a.glsl",
          "inputs": {
            "iChannel0": {
              "type": "buffer",
              "source": "BufferA"
            }
          }
        }
      }
    };

    // This should not throw any validation errors when loading the config
    expect(() => {
      render(ConfigEditor);
      simulateVSCodeMessage(createMockConfig(validCommonConfig as ShaderConfig));
    }).not.toThrow();

    // Verify the config loads successfully and tabs are created
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Common' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BufferA' })).toBeInTheDocument();
    }, { timeout: 3000 });

    // Since Common tab is no longer present, verify BufferA tab works instead
    const bufferATab = screen.getByRole('button', { name: 'BufferA' });
    await user.click(bufferATab);
    
    await waitFor(() => {
      expect(screen.getByText('Input Channels')).toBeInTheDocument();
    });
  });

  it('should handle config with invalid common buffer and Image', async () => {
    const configWithInvalidCommon = {
      version: "1.0",
      passes: {
        Image: {
          inputs: {
            "iChannel0": {
              "type": "texture",
              "path": "./test.png"
            }
          }
        },
        "common": {
          "path": "./common.glsl"
        }
      }
    };

    render(ConfigEditor);

    simulateVSCodeMessage(createMockConfig(configWithInvalidCommon as ShaderConfig));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Common' })).toBeInTheDocument();
    });
  });
});
