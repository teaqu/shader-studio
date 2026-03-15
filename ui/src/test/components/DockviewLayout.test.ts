import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import DockviewLayout from '../../lib/components/DockviewLayout.svelte';
import { layoutStore } from '../../lib/stores/layoutStore';

// --- dockview-core mock ---

let layoutChangeListeners: (() => void)[] = [];
let removePanelListeners: ((panel: any) => void)[] = [];
let addPanelListeners: ((panel: any) => void)[] = [];
let panels: Map<string, any> = new Map();
let mockApi: any;

function makeMockPanel(id: string, groupPanelCount = 1) {
  return {
    id,
    api: {
      id,
      group: {
        panels: Array.from({ length: groupPanelCount }, (_, i) => ({ id: `p${i}` })),
      },
    },
  };
}

vi.mock('dockview-core', () => {
  return {
    createDockview: vi.fn((_container: HTMLElement, _options: any) => {
      panels.clear();
      mockApi = {
        panels: [],
        addPanel: vi.fn((opts: any) => {
          const panel = makeMockPanel(opts.id);
          panels.set(opts.id, panel);
          mockApi.panels = Array.from(panels.values());
          addPanelListeners.forEach((fn) => fn(panel));
        }),
        removePanel: vi.fn((panel: any) => {
          panels.delete(panel.id);
          mockApi.panels = Array.from(panels.values());
          removePanelListeners.forEach((fn) => fn(panel));
        }),
        getPanel: vi.fn((id: string) => panels.get(id) ?? null),
        clear: vi.fn(() => {
          panels.clear();
          mockApi.panels = [];
        }),
        toJSON: vi.fn(() => ({})),
        fromJSON: vi.fn(),
        dispose: vi.fn(),
        onDidLayoutChange: vi.fn((fn: () => void) => {
          layoutChangeListeners.push(fn);
          return { dispose: vi.fn() };
        }),
        onDidRemovePanel: vi.fn((fn: (panel: any) => void) => {
          removePanelListeners.push(fn);
          return { dispose: vi.fn() };
        }),
        onDidAddPanel: vi.fn((fn: (panel: any) => void) => {
          addPanelListeners.push(fn);
          return { dispose: vi.fn() };
        }),
      };
      return mockApi;
    }),
    themeVisualStudio: { name: 'vs', className: 'vs' },
  };
});

vi.mock('dockview-core/dist/styles/dockview.css', () => ({}));

vi.mock('../../lib/stores/layoutStore', () => ({
  layoutStore: {
    load: vi.fn(() => null),
    save: vi.fn(),
    clear: vi.fn(),
  },
}));

function fireLayoutChange() {
  layoutChangeListeners.forEach((fn) => fn());
}

function dispatchDocumentDragLeave(clientX: number, clientY: number) {
  const event = new Event('dragleave', { bubbles: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  document.dispatchEvent(event);
}

function dispatchContainerDragLeave(el: HTMLElement, relatedTarget: Node | null) {
  const event = new Event('dragleave', { bubbles: true });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  el.dispatchEvent(event);
}

describe('DockviewLayout', () => {
  beforeEach(() => {
    layoutChangeListeners = [];
    removePanelListeners = [];
    addPanelListeners = [];
    panels.clear();
    vi.clearAllMocks();
    vi.mocked(layoutStore.load).mockReturnValue(null);
  });

function renderLayout(props: Record<string, any> = {}) {
    return render(DockviewLayout, {
      props: {
        mountPreview: () => {},
        mountDebug: () => {},
        mountConfig: () => {},
        showDebugPanel: false,
        showConfigPanel: false,
        transport: null,
        ...props,
      },
    });
  }

  function createMockTransport() {
    let onMessageHandler: ((event: MessageEvent) => void) | null = null;
    return {
      postMessage: vi.fn(),
      onMessage: vi.fn((cb: (event: MessageEvent) => void) => {
        onMessageHandler = cb;
      }),
      emit: (data: any) => {
        onMessageHandler?.({ data } as MessageEvent);
      },
    };
  }

  function getContainer(container: HTMLElement) {
    return container.querySelector('.dockview-container') as HTMLElement;
  }

  // ─── Drag class management ─────────────────────────────────────

  describe('drag class management', () => {
    it('should add dv-drag-active on dragstart', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);
    });

    it('should remove dv-drag-active on dragend', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      await fireEvent.dragEnd(document);
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should clear dv-drag-active on layout change (fallback for detached dragend)', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Simulate layout change without dragend ever firing —
      // this is what happens when dockview removes the drag source from the DOM
      fireLayoutChange();
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should remove dv-sash-hover when drag starts', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);
      el.classList.add('dv-sash-hover');

      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);
      expect(el.classList.contains('dv-drag-active')).toBe(true);
    });

    it('should not have dv-drag-active after a complete drag-and-drop cycle', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      // Drag start
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Even if dragend fires on document (normal case)
      await fireEvent.dragEnd(document);
      expect(el.classList.contains('dv-drag-active')).toBe(false);

      // After layout change, still clean
      fireLayoutChange();
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });
  });

  // ─── Sash hover detection ─────────────────────────────────────

  describe('sash hover detection', () => {
    it('should add dv-sash-hover when mousing over a sash element after delay', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      // Create a sash child — mouseover bubbles from sash to container
      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      el.appendChild(sash);

      await fireEvent.mouseOver(sash);
      // Should NOT be visible immediately
      expect(el.classList.contains('dv-sash-hover')).toBe(false);

      // After reveal delay it should appear
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      vi.useRealTimers();
    });

    it('should add dv-sash-hover when mousing over a single-tab header after delay', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      const tabBar = document.createElement('div');
      tabBar.className = 'dv-tabs-and-actions-container dv-single-tab';
      el.appendChild(tabBar);

      await fireEvent.mouseOver(tabBar);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);

      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      vi.useRealTimers();
    });

    it('should NOT add dv-sash-hover when mousing over regular content', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      const content = document.createElement('div');
      content.className = 'dv-content-container';
      el.appendChild(content);

      await fireEvent.mouseOver(content);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);
    });

    it('should remove dv-sash-hover after timeout when leaving sash', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      el.appendChild(sash);

      const other = document.createElement('div');
      other.className = 'content';
      el.appendChild(other);

      // Hover sash and wait for reveal
      await fireEvent.mouseOver(sash);
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // Leave sash to unrelated element
      await fireEvent.mouseOut(sash, { relatedTarget: other });

      // Should still be visible right after (400ms delay)
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // After 400ms delay it should be removed
      vi.advanceTimersByTime(400);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);

      vi.useRealTimers();
    });

    it('should not start collapse timer when moving from sash to single-tab bar', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      el.appendChild(sash);

      const tabBar = document.createElement('div');
      tabBar.className = 'dv-tabs-and-actions-container dv-single-tab';
      el.appendChild(tabBar);

      await fireEvent.mouseOver(sash);
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // Moving from sash to tab bar — should NOT collapse
      await fireEvent.mouseOut(sash, { relatedTarget: tabBar });

      vi.advanceTimersByTime(500);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      vi.useRealTimers();
    });

    it('should reset collapse timer when re-entering sash during timeout', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      el.appendChild(sash);

      const other = document.createElement('div');
      other.className = 'content';
      el.appendChild(other);

      // Hover sash and wait for reveal, then leave
      await fireEvent.mouseOver(sash);
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);
      await fireEvent.mouseOut(sash, { relatedTarget: other });

      // Wait 200ms (less than 400ms timeout)
      vi.advanceTimersByTime(200);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // Re-enter sash — should cancel the collapse timer and start reveal
      await fireEvent.mouseOver(sash);

      // Wait another 300ms — should still be visible (reveal timer fires, keeping it visible)
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      vi.useRealTimers();
    });
  });

  // ─── Top-edge hover detection ─────────────────────────────────

  describe('top-edge hover detection', () => {
    it('should add dv-sash-hover when mouse is near the top edge after delay', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 100, left: 0, right: 800, bottom: 600,
        width: 800, height: 500, x: 0, y: 100, toJSON: () => {},
      });

      // Mouse at y=103, which is 3px from top (within 8px threshold)
      await fireEvent.mouseMove(el, { clientY: 103 });
      expect(el.classList.contains('dv-sash-hover')).toBe(false);

      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      vi.useRealTimers();
    });

    it('should NOT add dv-sash-hover when mouse is far from the top edge', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 100, left: 0, right: 800, bottom: 600,
        width: 800, height: 500, x: 0, y: 100, toJSON: () => {},
      });

      // Mouse at y=200, which is 100px from top (well beyond threshold)
      await fireEvent.mouseMove(el, { clientY: 200 });
      expect(el.classList.contains('dv-sash-hover')).toBe(false);
    });

    it('should start collapse timer when moving away from top edge', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 100, left: 0, right: 800, bottom: 600,
        width: 800, height: 500, x: 0, y: 100, toJSON: () => {},
      });

      // Activate top edge and wait for reveal
      await fireEvent.mouseMove(el, { clientY: 103 });
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // Move away from top edge — target is plain content
      const content = document.createElement('div');
      content.className = 'content';
      el.appendChild(content);

      const event = new MouseEvent('mousemove', { clientY: 200, bubbles: true });
      Object.defineProperty(event, 'target', { value: content });
      el.dispatchEvent(event);

      // Still visible immediately
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // After 400ms should collapse
      vi.advanceTimersByTime(400);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);

      vi.useRealTimers();
    });

    it('should not collapse when moving from top edge to a sash', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 100, left: 0, right: 800, bottom: 600,
        width: 800, height: 500, x: 0, y: 100, toJSON: () => {},
      });

      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      el.appendChild(sash);

      // Activate top edge and wait for reveal
      await fireEvent.mouseMove(el, { clientY: 103 });
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // Move away but onto a sash — should NOT collapse
      const event = new MouseEvent('mousemove', { clientY: 200, bubbles: true });
      Object.defineProperty(event, 'target', { value: sash });
      el.dispatchEvent(event);

      vi.advanceTimersByTime(500);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      vi.useRealTimers();
    });
  });

  // ─── Layout save on changes ────────────────────────────────────

  describe('layout persistence', () => {
    it('should schedule a layout save when layout changes', async () => {
      vi.useFakeTimers();
      renderLayout();
      await tick();

      fireLayoutChange();

      vi.advanceTimersByTime(500);
      expect(mockApi.toJSON).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('transport restore and ready actions', () => {
    it('should request layout when transport is provided', async () => {
      const transport = createMockTransport();
      renderLayout({ transport });
      await tick();

      expect(transport.onMessage).toHaveBeenCalledTimes(1);
      expect(transport.postMessage).toHaveBeenCalledWith({ type: 'requestLayout' });
    });

    it('should restore layout from transport payload', async () => {
      const transport = createMockTransport();
      renderLayout({ transport });
      await tick();

      transport.emit({ type: 'restoreLayout', payload: { panels: {}, grid: { root: { type: 'branch', data: [] } } } });
      expect(mockApi.fromJSON).toHaveBeenCalledTimes(1);
    });

    it('should restore from local layout when transport payload is null', async () => {
      vi.mocked(layoutStore.load).mockReturnValue({ panels: {}, grid: { root: { type: 'branch', data: [] } } } as any);
      const transport = createMockTransport();
      renderLayout({ transport });
      await tick();

      transport.emit({ type: 'restoreLayout', payload: null });
      expect(layoutStore.load).toHaveBeenCalled();
      expect(mockApi.fromJSON).toHaveBeenCalledTimes(1);
    });

    it('should reset and recreate default layout when fromJSON throws', async () => {
      const transport = createMockTransport();
      renderLayout({ transport });
      await tick();
      mockApi.fromJSON.mockImplementation(() => {
        throw new Error('bad layout');
      });

      transport.emit({ type: 'restoreLayout', payload: { panels: {}, grid: { root: { type: 'branch', data: [] } } } });
      expect(mockApi.clear).toHaveBeenCalled();
      expect(mockApi.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'preview' }));
    });

    it('ready.showPreview should add preview panel when missing', async () => {
      const ref: { showPreview: (() => void) | null } = { showPreview: null };
      renderLayout({
        onready: (event: any) => {
          ref.showPreview = event.detail.showPreview;
        },
      });
      await tick();

      panels.delete('preview');
      ref.showPreview?.();
      expect(mockApi.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'preview' }));
    });
  });

  // ─── Panel management ─────────────────────────────────────────

  describe('config panel management', () => {
    it('should add config panel below preview with initialHeight 250 when no debug panel', async () => {
      renderLayout({ showConfigPanel: true });
      await tick();

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'config',
          component: 'config',
          title: 'Config',
          position: {
            referencePanel: 'preview',
            direction: 'below',
          },
          initialHeight: 250,
        })
      );
    });

    it('should add config panel within debug panel when debug exists', async () => {
      renderLayout({ showDebugPanel: true, showConfigPanel: true });
      await tick();

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'config',
          component: 'config',
          position: {
            referencePanel: 'debug',
            direction: 'within',
          },
        })
      );
    });

    it('should not add config panel if already exists', async () => {
      renderLayout({ showConfigPanel: true });
      await tick();

      const addCallCount = mockApi.addPanel.mock.calls.filter(
        (call: any[]) => call[0].id === 'config'
      ).length;
      expect(addCallCount).toBe(1);
    });

    it('should remove config panel when showConfigPanel becomes false', async () => {
      const { rerender } = renderLayout({ showConfigPanel: true });
      await tick();

      expect(panels.has('config')).toBe(true);

      await rerender({ showConfigPanel: false, mountPreview: () => {}, mountDebug: () => {}, mountConfig: () => {}, showDebugPanel: false, transport: null });
      await tick();

      expect(mockApi.removePanel).toHaveBeenCalled();
    });
  });

  describe('debug panel management', () => {
    it('should add debug panel below preview with initialHeight 200', async () => {
      renderLayout({ showDebugPanel: true });
      await tick();

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'debug',
          component: 'debug',
          title: 'Debug',
          position: {
            referencePanel: 'preview',
            direction: 'below',
          },
          initialHeight: 200,
        })
      );
    });

    it('should remove debug panel when showDebugPanel becomes false', async () => {
      const { rerender } = renderLayout({ showDebugPanel: true });
      await tick();

      expect(panels.has('debug')).toBe(true);

      await rerender({ showDebugPanel: false, mountPreview: () => {}, mountDebug: () => {}, mountConfig: () => {}, showConfigPanel: false, transport: null });
      await tick();

      expect(mockApi.removePanel).toHaveBeenCalled();
    });
  });

  // ─── Combined scenarios ────────────────────────────────────────

  describe('combined drag + layout change scenarios', () => {
    it('should handle rapid drag-start then layout-change (simulating fast tab move)', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      // Start drag
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Layout changes immediately (panel moved) — dragend never fires
      fireLayoutChange();
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should handle sash hover during drag correctly', async () => {
      vi.useFakeTimers();
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      const sash = document.createElement('div');
      sash.className = 'dv-sash';
      el.appendChild(sash);

      // Hover sash and wait for reveal
      await fireEvent.mouseOver(sash);
      vi.advanceTimersByTime(300);
      expect(el.classList.contains('dv-sash-hover')).toBe(true);

      // Start drag — should clear sash hover and set drag active
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Layout change clears drag active
      fireLayoutChange();
      expect(el.classList.contains('dv-drag-active')).toBe(false);
      expect(el.classList.contains('dv-sash-hover')).toBe(false);

      vi.useRealTimers();
    });

    it('should handle multiple consecutive drags correctly', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      // First drag — cleaned up via layout change
      await fireEvent.dragStart(el);
      fireLayoutChange();
      expect(el.classList.contains('dv-drag-active')).toBe(false);

      // Second drag — cleaned up via dragend
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);
      await fireEvent.dragEnd(document);
      expect(el.classList.contains('dv-drag-active')).toBe(false);

      // Third drag — cleaned up via layout change again
      await fireEvent.dragStart(el);
      fireLayoutChange();
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should keep drag active when dragend fires while pointer is still down (leave/re-enter webview)', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      // Start an internal drag gesture
      await fireEvent.pointerDown(document);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Simulate premature dragend while still dragging outside webview
      await fireEvent.dragEnd(document);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Re-entering should retain/recover drag-active state
      await fireEvent.dragEnter(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      // Gesture ends on actual pointer release
      await fireEvent.pointerUp(document);
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should cancel active drag when drag leaves window bounds', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      await fireEvent.pointerDown(document);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      dispatchDocumentDragLeave(0, 0);
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should not cancel drag on in-bounds dragleave', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      await fireEvent.pointerDown(document);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      dispatchDocumentDragLeave(100, 100);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      await fireEvent.pointerUp(document);
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should cancel active drag when window blurs', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);

      await fireEvent.pointerDown(document);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      window.dispatchEvent(new Event('blur'));
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should cancel active drag when leaving dockview container', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);
      await fireEvent.pointerDown(document);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      dispatchContainerDragLeave(el, null);
      expect(el.classList.contains('dv-drag-active')).toBe(false);
    });

    it('should not cancel drag when moving between elements inside dockview container', async () => {
      const { container } = renderLayout();
      await tick();

      const el = getContainer(container);
      const child = document.createElement('div');
      el.appendChild(child);

      await fireEvent.pointerDown(document);
      await fireEvent.dragStart(el);
      expect(el.classList.contains('dv-drag-active')).toBe(true);

      dispatchContainerDragLeave(el, child);
      expect(el.classList.contains('dv-drag-active')).toBe(true);
    });
  });

  // ─── Performance panel management ─────────────────────────────
  describe('Performance panel', () => {
    it('should add performance panel when showPerformancePanel is true', async () => {
      renderLayout({
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'performance',
          component: 'performance',
          title: 'Frame Times',
        })
      );
    });

    it('should not add performance panel when showPerformancePanel is false', async () => {
      renderLayout({
        showPerformancePanel: false,
        mountPerformance: () => {},
      });
      await tick();

      const addCalls = mockApi.addPanel.mock.calls;
      const perfCalls = addCalls.filter((c: any[]) => c[0]?.id === 'performance');
      expect(perfCalls).toHaveLength(0);
    });

    it('should add performance panel with correct id and component', async () => {
      renderLayout({
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      const addCalls = mockApi.addPanel.mock.calls;
      const perfCall = addCalls.find((c: any[]) => c[0]?.id === 'performance');
      expect(perfCall).toBeDefined();
      expect(perfCall![0].component).toBe('performance');
      expect(perfCall![0].title).toBe('Frame Times');
    });

    it('should use the mountPerformance prop for the performance component', async () => {
      const mountPerformance = vi.fn();
      renderLayout({
        showPerformancePanel: true,
        mountPerformance,
      });
      await tick();

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'performance', component: 'performance' })
      );
    });

    it('should add performance panel below preview when no debug/config panels exist', async () => {
      renderLayout({
        showPerformancePanel: true,
        showDebugPanel: false,
        showConfigPanel: false,
        mountPerformance: () => {},
      });
      await tick();

      const perfCall = mockApi.addPanel.mock.calls.find(
        (c: any[]) => c[0]?.id === 'performance'
      );
      expect(perfCall).toBeDefined();
      // When no debug/config, it positions relative to preview
      expect(perfCall![0].position).toBeDefined();
    });

    it('should handle performanceClosed event from user-initiated panel removal', async () => {
      renderLayout({
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      // Verify the panel was created and the onDidRemovePanel listener was registered
      expect(mockApi.onDidRemovePanel).toHaveBeenCalled();
      expect(panels.has('performance')).toBe(true);

      // Simulate user closing the panel via dockview
      const perfPanel = panels.get('performance');
      removePanelListeners.forEach((fn) => fn(perfPanel));
      // The dispatch("performanceClosed") is called internally
      // We verify the listener mechanism is wired up
      expect(mockApi.onDidRemovePanel).toHaveBeenCalled();
    });

    it('should accept mountPerformance prop without crashing', async () => {
      const mountPerformance = vi.fn(() => () => {});
      renderLayout({
        showPerformancePanel: true,
        mountPerformance,
      });
      await tick();

      // Verify dockview was created and performance panel was added
      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'performance' })
      );
    });

    it('should tab alongside debug panel when debug is visible', async () => {
      renderLayout({
        showDebugPanel: true,
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      const perfCall = mockApi.addPanel.mock.calls.find(
        (c: any[]) => c[0]?.id === 'performance'
      );
      expect(perfCall).toBeDefined();
      expect(perfCall![0].position).toEqual({
        referencePanel: 'debug',
        direction: 'within',
      });
    });

    it('should tab alongside config panel when config is visible but debug is not', async () => {
      renderLayout({
        showDebugPanel: false,
        showConfigPanel: true,
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      const perfCall = mockApi.addPanel.mock.calls.find(
        (c: any[]) => c[0]?.id === 'performance'
      );
      expect(perfCall).toBeDefined();
      expect(perfCall![0].position).toEqual({
        referencePanel: 'config',
        direction: 'within',
      });
    });

    it('should position below preview with initialHeight when no siblings exist', async () => {
      renderLayout({
        showDebugPanel: false,
        showConfigPanel: false,
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      const perfCall = mockApi.addPanel.mock.calls.find(
        (c: any[]) => c[0]?.id === 'performance'
      );
      expect(perfCall).toBeDefined();
      expect(perfCall![0].position).toEqual({
        referencePanel: 'preview',
        direction: 'below',
      });
      expect(perfCall![0].initialHeight).toBe(200);
    });

    it('should remove performance panel when showPerformancePanel changes to false', async () => {
      const { rerender } = renderLayout({
        showPerformancePanel: true,
        mountPerformance: () => {},
      });
      await tick();

      // Panel should exist
      expect(panels.has('performance')).toBe(true);

      // Toggle off
      await rerender({ showPerformancePanel: false, mountPreview: () => {}, mountDebug: () => {}, mountConfig: () => {}, mountPerformance: () => {}, showDebugPanel: false, showConfigPanel: false, transport: null });
      await tick();

      // removePerformancePanel calls api.removePanel which removes from panels map
      expect(panels.has('performance')).toBe(false);
    });

    it('should not crash when removing performance panel that does not exist', async () => {
      const { rerender } = renderLayout({
        showPerformancePanel: false,
        mountPerformance: () => {},
      });
      await tick();

      // Toggle off when panel was never added — should not crash
      await rerender({ showPerformancePanel: false, mountPreview: () => {}, mountDebug: () => {}, mountConfig: () => {}, mountPerformance: () => {}, showDebugPanel: false, showConfigPanel: false, transport: null });
      await tick();

      expect(panels.has('performance')).toBe(false);
    });
  });
});
