import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import MiscTab from '../../../../lib/components/config/tabs/MiscTab.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('MiscTab', () => {
  const defaultProps = () => ({
    tempInput: undefined as ConfigInput | undefined,
    getWebviewUri: vi.fn((path: string) => `webview://path/${path}`),
    onSelect: vi.fn(),
  });

  describe('Rendering', () => {
    it('should render buffer cards for BufferA through BufferD', () => {
      const { container } = render(MiscTab, defaultProps());

      const labels = container.querySelectorAll('.misc-card-label');
      const labelTexts = Array.from(labels).map(el => el.textContent);
      expect(labelTexts).toContain('BufferA');
      expect(labelTexts).toContain('BufferB');
      expect(labelTexts).toContain('BufferC');
      expect(labelTexts).toContain('BufferD');
    });

    it('should render keyboard card', () => {
      const { container } = render(MiscTab, defaultProps());

      const labels = container.querySelectorAll('.misc-card-label');
      const labelTexts = Array.from(labels).map(el => el.textContent);
      expect(labelTexts).toContain('Keyboard');
    });

    it('should render section labels', () => {
      const { container } = render(MiscTab, defaultProps());

      const sectionLabels = container.querySelectorAll('.misc-section-label');
      expect(sectionLabels.length).toBe(2);
      expect(sectionLabels[0].textContent).toBe('Buffer');
      expect(sectionLabels[1].textContent).toBe('Other');
    });
  });

  describe('Selection', () => {
    it('should highlight selected buffer card', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'buffer', source: 'BufferC' } as ConfigInput,
      };

      const { container } = render(MiscTab, props);

      const labels = container.querySelectorAll('.misc-card-label');
      const bufferCLabel = Array.from(labels).find(el => el.textContent === 'BufferC');
      const bufferCButton = bufferCLabel?.closest('button');
      expect(bufferCButton?.classList.contains('selected')).toBe(true);

      // Other buffers should NOT be selected
      const bufferALabel = Array.from(labels).find(el => el.textContent === 'BufferA');
      const bufferAButton = bufferALabel?.closest('button');
      expect(bufferAButton?.classList.contains('selected')).toBe(false);
    });

    it('should highlight keyboard card when keyboard is selected', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'keyboard' } as ConfigInput,
      };

      const { container } = render(MiscTab, props);

      const labels = container.querySelectorAll('.misc-card-label');
      const keyboardLabel = Array.from(labels).find(el => el.textContent === 'Keyboard');
      const keyboardButton = keyboardLabel?.closest('button');
      expect(keyboardButton?.classList.contains('selected')).toBe(true);
    });

    it('should not highlight any card when no input is set', () => {
      const { container } = render(MiscTab, defaultProps());

      const selectedCards = container.querySelectorAll('.misc-card.selected');
      expect(selectedCards.length).toBe(0);
    });
  });

  describe('Callbacks', () => {
    it('should call onSelect with buffer input when buffer card clicked', async () => {
      const props = defaultProps();
      const { container } = render(MiscTab, props);

      const labels = container.querySelectorAll('.misc-card-label');
      const bufferBLabel = Array.from(labels).find(el => el.textContent === 'BufferB');
      const bufferBButton = bufferBLabel?.closest('button');
      await fireEvent.click(bufferBButton!);

      expect(props.onSelect).toHaveBeenCalledWith({
        type: 'buffer',
        source: 'BufferB',
      });
    });

    it('should call onSelect with keyboard input when keyboard card clicked', async () => {
      const props = defaultProps();
      const { container } = render(MiscTab, props);

      const labels = container.querySelectorAll('.misc-card-label');
      const keyboardLabel = Array.from(labels).find(el => el.textContent === 'Keyboard');
      const keyboardButton = keyboardLabel?.closest('button');
      await fireEvent.click(keyboardButton!);

      expect(props.onSelect).toHaveBeenCalledWith({
        type: 'keyboard',
      });
    });

    it('should call onSelect for each buffer type', async () => {
      const props = defaultProps();
      const { container } = render(MiscTab, props);

      const labels = container.querySelectorAll('.misc-card-label');
      for (const buf of ['BufferA', 'BufferB', 'BufferC', 'BufferD']) {
        const label = Array.from(labels).find(el => el.textContent === buf);
        const button = label?.closest('button');
        await fireEvent.click(button!);

        expect(props.onSelect).toHaveBeenCalledWith({
          type: 'buffer',
          source: buf,
        });
      }
      expect(props.onSelect).toHaveBeenCalledTimes(4);
    });
  });
});
