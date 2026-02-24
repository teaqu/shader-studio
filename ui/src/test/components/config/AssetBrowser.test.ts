import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import AssetBrowser from '../../../lib/components/config/AssetBrowser.svelte';

describe('AssetBrowser', () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;
  let mockOnSelect: ReturnType<typeof vi.fn>;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    mockOnSelect = vi.fn();

    // Capture the message event listener
    const originalAddEventListener = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, handler: any) => {
      if (type === 'message') {
        messageHandler = handler;
      }
      return originalAddEventListener.call(window, type, handler);
    });
  });

  afterEach(() => {
    messageHandler = null;
    vi.restoreAllMocks();
  });

  function simulateWorkspaceFiles(files: any[]) {
    if (messageHandler) {
      messageHandler(new MessageEvent('message', {
        data: {
          type: 'workspaceFiles',
          payload: { files },
        },
      }));
    }
  }

  const sampleFiles = [
    { name: 'noise.png', workspacePath: '@/textures/noise.png', thumbnailUri: 'webview://noise.png', isSameDirectory: true },
    { name: 'gradient.jpg', workspacePath: '@/textures/gradient.jpg', thumbnailUri: 'webview://gradient.jpg', isSameDirectory: true },
    { name: 'sky.hdr', workspacePath: '@/assets/sky.hdr', thumbnailUri: 'webview://sky.hdr', isSameDirectory: false },
    { name: 'stone.png', workspacePath: '@/materials/stone.png', thumbnailUri: 'webview://stone.png', isSameDirectory: false },
  ];

  describe('Initialization', () => {
    it('should send requestWorkspaceFiles on mount', () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'requestWorkspaceFiles',
        payload: { extensions: ['png', 'jpg'], shaderPath: '/test/shader.glsl' },
      });
    });

    it('should show loading state initially', () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      expect(screen.getByText('Loading files...')).toBeInTheDocument();
    });
  });

  describe('File Display', () => {
    it('should render file list from message response', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);

      // Wait for reactivity
      await new Promise(r => setTimeout(r, 10));

      expect(screen.getByText('noise.png')).toBeInTheDocument();
      expect(screen.getByText('gradient.jpg')).toBeInTheDocument();
      expect(screen.getByText('sky.hdr')).toBeInTheDocument();
      expect(screen.getByText('stone.png')).toBeInTheDocument();
    });

    it('should group same-directory files under Same Folder header', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      expect(screen.getByText('Same Folder')).toBeInTheDocument();
      expect(screen.getByText('Workspace')).toBeInTheDocument();
    });

    it('should show empty state when no files found', async () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([]);
      await new Promise(r => setTimeout(r, 10));

      expect(screen.getByText('No files found')).toBeInTheDocument();
    });
  });

  describe('File Selection', () => {
    it('should call onSelect with filename for same-directory files', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const noiseCard = screen.getByText('noise.png').closest('button');
      await fireEvent.click(noiseCard!);

      expect(mockOnSelect).toHaveBeenCalledWith('noise.png');
    });

    it('should call onSelect with workspace path for other files', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const skyCard = screen.getByText('sky.hdr').closest('button');
      await fireEvent.click(skyCard!);

      expect(mockOnSelect).toHaveBeenCalledWith('@/assets/sky.hdr');
    });
  });

  describe('Search Filtering', () => {
    it('should filter files by search query', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const searchInput = screen.getByPlaceholderText('Search files...');
      await fireEvent.input(searchInput, { target: { value: 'noise' } });
      await new Promise(r => setTimeout(r, 10));

      expect(screen.getByText('noise.png')).toBeInTheDocument();
      expect(screen.queryByText('gradient.jpg')).not.toBeInTheDocument();
      expect(screen.queryByText('sky.hdr')).not.toBeInTheDocument();
    });
  });

  describe('Refresh', () => {
    it('should re-request files when refresh is clicked', async () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      mockPostMessage.mockClear();

      const refreshBtn = screen.getByTitle('Refresh');
      await fireEvent.click(refreshBtn);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'requestWorkspaceFiles',
        payload: { extensions: ['png'], shaderPath: '/test/shader.glsl' },
      });
    });
  });

  describe('Selected Highlight', () => {
    it('should highlight the selected file', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
        selectedPath: 'noise.png',
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const noiseCard = screen.getByText('noise.png').closest('button');
      expect(noiseCard?.classList.contains('selected')).toBe(true);

      const gradientCard = screen.getByText('gradient.jpg').closest('button');
      expect(gradientCard?.classList.contains('selected')).toBe(false);
    });

    it('should highlight workspace file selected by @/ path', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
        selectedPath: '@/assets/sky.hdr',
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const skyCard = screen.getByText('sky.hdr').closest('button');
      expect(skyCard?.classList.contains('selected')).toBe(true);

      const stoneCard = screen.getByText('stone.png').closest('button');
      expect(stoneCard?.classList.contains('selected')).toBe(false);
    });
  });

  describe('File Type Thumbnails', () => {
    it('should render video element for video files', async () => {
      render(AssetBrowser, {
        extensions: ['mp4', 'webm'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([
        { name: 'clip.mp4', workspacePath: '@/videos/clip.mp4', thumbnailUri: 'webview://clip.mp4', isSameDirectory: false },
      ]);
      await new Promise(r => setTimeout(r, 10));

      const card = screen.getByText('clip.mp4').closest('button')!;
      const video = card.querySelector('video');
      const img = card.querySelector('img');
      expect(video).not.toBeNull();
      expect(img).toBeNull();
      expect(video!.getAttribute('preload')).toBe('metadata');
      expect(video!.muted).toBe(true);
    });

    it('should render audio placeholder for audio files', async () => {
      render(AssetBrowser, {
        extensions: ['mp3', 'wav'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([
        { name: 'song.mp3', workspacePath: '@/music/song.mp3', thumbnailUri: 'webview://song.mp3', isSameDirectory: false },
      ]);
      await new Promise(r => setTimeout(r, 10));

      const card = screen.getByText('song.mp3').closest('button')!;
      const placeholder = card.querySelector('[aria-label="audio file"]');
      const img = card.querySelector('img');
      expect(placeholder).not.toBeNull();
      expect(img).toBeNull();
    });

    it('should play audio on mouseenter and pause+reset on mouseleave', async () => {
      render(AssetBrowser, {
        extensions: ['mp3'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([
        { name: 'song.mp3', workspacePath: '@/music/song.mp3', thumbnailUri: 'webview://song.mp3', isSameDirectory: false },
      ]);
      await new Promise(r => setTimeout(r, 10));

      const card = screen.getByText('song.mp3').closest('button')!;
      const placeholder = card.querySelector('[aria-label="audio file"]')!;
      const audio = placeholder.querySelector('audio')!;

      const playSpy = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
      const pauseSpy = vi.spyOn(audio, 'pause').mockImplementation(() => {});

      await fireEvent.mouseEnter(placeholder);
      expect(playSpy).toHaveBeenCalled();

      await fireEvent.mouseLeave(placeholder);
      expect(pauseSpy).toHaveBeenCalled();
      expect(audio.currentTime).toBe(0);
    });

    it('should play video on mouseenter and pause+reset on mouseleave', async () => {
      render(AssetBrowser, {
        extensions: ['mp4'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([
        { name: 'clip.mp4', workspacePath: '@/videos/clip.mp4', thumbnailUri: 'webview://clip.mp4', isSameDirectory: false },
      ]);
      await new Promise(r => setTimeout(r, 10));

      const card = screen.getByText('clip.mp4').closest('button')!;
      const video = card.querySelector('video')!;

      const playSpy = vi.spyOn(video, 'play').mockResolvedValue(undefined);
      const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {});

      await fireEvent.mouseEnter(video);
      expect(playSpy).toHaveBeenCalled();

      await fireEvent.mouseLeave(video);
      expect(pauseSpy).toHaveBeenCalled();
      expect(video.currentTime).toBe(0);
    });

    it('should render img element for image files', async () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([
        { name: 'texture.png', workspacePath: '@/textures/texture.png', thumbnailUri: 'webview://texture.png', isSameDirectory: false },
      ]);
      await new Promise(r => setTimeout(r, 10));

      const card = screen.getByText('texture.png').closest('button')!;
      const img = card.querySelector('img');
      const video = card.querySelector('video');
      expect(img).not.toBeNull();
      expect(video).toBeNull();
    });

    it('should render volume placeholder for volume files', async () => {
      render(AssetBrowser, {
        extensions: ['bin', 'raw'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles([
        { name: 'data.bin', workspacePath: '@/volumes/data.bin', thumbnailUri: 'webview://data.bin', isSameDirectory: false },
      ]);
      await new Promise(r => setTimeout(r, 10));

      const card = screen.getByText('data.bin').closest('button')!;
      const placeholder = card.querySelector('[aria-label="volume file"]');
      const img = card.querySelector('img');
      expect(placeholder).not.toBeNull();
      expect(img).toBeNull();
    });
  });

  describe('@/ Workspace Path Handling', () => {
    it('should return @/ prefixed path when selecting non-same-directory file', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      // Click a workspace file (not in same directory)
      const stoneCard = screen.getByText('stone.png').closest('button');
      await fireEvent.click(stoneCard!);

      expect(mockOnSelect).toHaveBeenCalledWith('@/materials/stone.png');
    });

    it('should return just filename when selecting same-directory file', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      // Click a same-directory file
      const gradientCard = screen.getByText('gradient.jpg').closest('button');
      await fireEvent.click(gradientCard!);

      expect(mockOnSelect).toHaveBeenCalledWith('gradient.jpg');
    });
  });
});
