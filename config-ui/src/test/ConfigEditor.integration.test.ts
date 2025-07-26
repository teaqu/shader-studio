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
      expect(screen.getByText(/Invalid JSON.*Failed to.*is not valid JSON/)).toBeInTheDocument();
    });
  });

  it('should display simple config correctly', async () => {
    render(ConfigEditor);
    
    simulateVSCodeMessage(createMockConfig(simpleConfig as ShaderConfig));
    
    await waitFor(() => {
      expect(screen.getByText('Shader Configuration')).toBeInTheDocument();
      expect(screen.getByText('Click the "JSON" button in the status bar to edit the raw JSON directly')).toBeInTheDocument();
      
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
});
