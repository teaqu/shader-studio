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

      expect(mockOnSelect).toHaveBeenCalledWith('noise.png', 'webview://noise.png');
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

      expect(mockOnSelect).toHaveBeenCalledWith('@/assets/sky.hdr', 'webview://sky.hdr');
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

    it('should render audio waveform thumbnail for audio files', async () => {
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
      const waveformThumbnail = card.querySelector('.audio-waveform-thumbnail');
      const img = card.querySelector('img');
      expect(waveformThumbnail).not.toBeNull();
      expect(img).toBeNull();
    });

    it('should render waveform canvas inside audio thumbnail', async () => {
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
      const waveformThumbnail = card.querySelector('.audio-waveform-thumbnail')!;
      const canvas = waveformThumbnail.querySelector('canvas.waveform-canvas');
      expect(canvas).not.toBeNull();
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

  });

  describe('Transport onMessage (WebSocket)', () => {
    it('should receive files via onMessage instead of window events', async () => {
      let transportHandler: ((event: MessageEvent) => void) | null = null;
      const mockOnMessage = vi.fn((handler: (event: MessageEvent) => void) => {
        transportHandler = handler;
      });

      render(AssetBrowser, {
        extensions: ['png', 'jpg'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onMessage: mockOnMessage,
        onSelect: mockOnSelect,
      });

      expect(mockOnMessage).toHaveBeenCalledTimes(1);

      // Simulate transport delivering workspaceFiles response
      transportHandler!(new MessageEvent('message', {
        data: {
          type: 'workspaceFiles',
          payload: { files: sampleFiles },
        },
      }));

      await new Promise(r => setTimeout(r, 10));

      expect(screen.getByText('noise.png')).toBeInTheDocument();
      expect(screen.getByText('gradient.jpg')).toBeInTheDocument();
      expect(screen.getByText('sky.hdr')).toBeInTheDocument();
      expect(screen.getByText('stone.png')).toBeInTheDocument();
    });

    it('should not add window event listener when onMessage is provided', () => {
      const mockOnMessage = vi.fn();

      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onMessage: mockOnMessage,
        onSelect: mockOnSelect,
      });

      // window.addEventListener was spied in beforeEach
      const addEventCalls = (window.addEventListener as any).mock?.calls || [];
      const messageListenerAdded = addEventCalls.some(
        (call: any[]) => call[0] === 'message'
      );
      expect(messageListenerAdded).toBe(false);
    });
  });

  describe('Pagination', () => {
    // Generate more than PAGE_SIZE (8) files to trigger pagination
    const manyFiles = Array.from({ length: 20 }, (_, i) => ({
      name: `file${i}.png`,
      workspacePath: `@/textures/file${i}.png`,
      thumbnailUri: `webview://file${i}.png`,
      isSameDirectory: false,
    }));

    it('should paginate files when more than PAGE_SIZE', async () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      // Should only show 8 files on the first page
      const fileCards = screen.getAllByRole('button').filter(b => b.classList.contains('file-card'));
      expect(fileCards.length).toBe(8);

      // Pagination controls should be visible
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('should navigate to next page', async () => {
      const { container } = render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      // Should have file0..file7 on first page
      expect(screen.getByText('file0.png')).toBeInTheDocument();

      // Click next page button
      const nextBtn = container.querySelector('.codicon-chevron-right')!.closest('button')!;
      await fireEvent.click(nextBtn);
      await new Promise(r => setTimeout(r, 10));

      // Now should show file8..file15
      expect(screen.getByText('file8.png')).toBeInTheDocument();
      expect(screen.queryByText('file0.png')).not.toBeInTheDocument();
    });

    it('should navigate to previous page', async () => {
      const { container } = render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      // Go to page 2
      const nextBtn = container.querySelector('.codicon-chevron-right')!.closest('button')!;
      await fireEvent.click(nextBtn);
      await new Promise(r => setTimeout(r, 10));

      // Go back to page 1
      const prevBtn = container.querySelector('.codicon-chevron-left')!.closest('button')!;
      await fireEvent.click(prevBtn);
      await new Promise(r => setTimeout(r, 10));

      expect(screen.getByText('file0.png')).toBeInTheDocument();
    });

    it('should jump to a specific page via goToPage', async () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      // Click on page 3 button
      const page3Btn = screen.getByText('3');
      await fireEvent.click(page3Btn);
      await new Promise(r => setTimeout(r, 10));

      // Page 3: files 16-19
      expect(screen.getByText('file16.png')).toBeInTheDocument();
    });

    it('should disable prev button on first page', async () => {
      const { container } = render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      const prevBtn = container.querySelector('.codicon-chevron-left')!.closest('button')!;
      expect(prevBtn).toBeDisabled();
    });

    it('should disable next button on last page', async () => {
      const { container } = render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      // Go to last page (page 3)
      const page3Btn = screen.getByText('3');
      await fireEvent.click(page3Btn);
      await new Promise(r => setTimeout(r, 10));

      const nextBtn = container.querySelector('.codicon-chevron-right')!.closest('button')!;
      expect(nextBtn).toBeDisabled();
    });

    it('should reset to page 1 when search query changes', async () => {
      const { container } = render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(manyFiles);
      await new Promise(r => setTimeout(r, 10));

      // Go to page 2
      const nextBtn = container.querySelector('.codicon-chevron-right')!.closest('button')!;
      await fireEvent.click(nextBtn);
      await new Promise(r => setTimeout(r, 10));

      expect(screen.queryByText('file0.png')).not.toBeInTheDocument();

      // Type in search => should reset to page 1
      const searchInput = screen.getByPlaceholderText('Search files...');
      await fireEvent.input(searchInput, { target: { value: 'file1' } });
      await new Promise(r => setTimeout(r, 10));

      // file1.png, file10..file19 match - should show first page of those results
      expect(screen.getByText('file1.png')).toBeInTheDocument();
    });
  });

  describe('Loading Timeout', () => {
    it('should show loading=false immediately when no postMessage function provided', () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        onSelect: mockOnSelect,
        // No postMessage
      });

      // Without postMessage, loading is set to false immediately => "No files found"
      expect(screen.getByText('No files found')).toBeInTheDocument();
    });
  });

  describe('Selection Highlight with ./ prefix', () => {
    it('should highlight file when selectedPath uses ./ prefix', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
        selectedPath: './noise.png',
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const noiseCard = screen.getByText('noise.png').closest('button');
      expect(noiseCard?.classList.contains('selected')).toBe(true);
    });

    it('should not highlight anything when selectedPath is empty', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
        selectedPath: '',
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const noiseCard = screen.getByText('noise.png').closest('button');
      expect(noiseCard?.classList.contains('selected')).toBe(false);
    });
  });

  describe('Search by workspace path', () => {
    it('should filter files by workspace path', async () => {
      render(AssetBrowser, {
        extensions: ['png', 'jpg', 'hdr'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      simulateWorkspaceFiles(sampleFiles);
      await new Promise(r => setTimeout(r, 10));

      const searchInput = screen.getByPlaceholderText('Search files...');
      await fireEvent.input(searchInput, { target: { value: 'materials' } });
      await new Promise(r => setTimeout(r, 10));

      // Only stone.png is in @/materials/
      expect(screen.getByText('stone.png')).toBeInTheDocument();
      expect(screen.queryByText('noise.png')).not.toBeInTheDocument();
    });
  });

  describe('Non-workspaceFiles messages', () => {
    it('should ignore messages with a different type', async () => {
      render(AssetBrowser, {
        extensions: ['png'],
        shaderPath: '/test/shader.glsl',
        postMessage: mockPostMessage,
        onSelect: mockOnSelect,
      });

      // Send a message with a different type
      if (messageHandler) {
        messageHandler(new MessageEvent('message', {
          data: { type: 'somethingElse', payload: {} },
        }));
      }
      await new Promise(r => setTimeout(r, 10));

      // Should still be in loading state
      expect(screen.getByText('Loading files...')).toBeInTheDocument();
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

      expect(mockOnSelect).toHaveBeenCalledWith('@/materials/stone.png', 'webview://stone.png');
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

      expect(mockOnSelect).toHaveBeenCalledWith('gradient.jpg', 'webview://gradient.jpg');
    });
  });
});
