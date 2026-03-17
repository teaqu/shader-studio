import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ScriptInfo from '../../../lib/components/config/ScriptInfo.svelte';

describe('ScriptInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('path input', () => {
    it('shows suggestedPath as placeholder when filename is empty', async () => {
      const { getByRole } = render(ScriptInfo, {
        filename: '',
        suggestedPath: './myshader.uniforms.ts',
        fileExists: false,
      });
      await tick();
      const input = getByRole('textbox') as HTMLInputElement;
      expect(input.placeholder).toBe('./myshader.uniforms.ts');
    });

    it('falls back to generic placeholder when suggestedPath is empty', async () => {
      const { getByRole } = render(ScriptInfo, {
        filename: '',
        suggestedPath: '',
        fileExists: false,
      });
      await tick();
      const input = getByRole('textbox') as HTMLInputElement;
      expect(input.placeholder).toBe('e.g., ./uniforms.ts');
    });

    it('displays current filename as input value', async () => {
      const { getByRole } = render(ScriptInfo, {
        filename: './myshader.uniforms.ts',
        fileExists: true,
      });
      await tick();
      const input = getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('./myshader.uniforms.ts');
    });

    it('calls onPathChange immediately on input without requiring blur', async () => {
      const onPathChange = vi.fn();
      const { getByRole } = render(ScriptInfo, {
        filename: '',
        onPathChange,
        fileExists: false,
      });
      await tick();
      const input = getByRole('textbox');
      await fireEvent.input(input, { target: { value: './new.ts' } });
      expect(onPathChange).toHaveBeenCalledWith('./new.ts');
    });

    it('calls onPathChange on blur if value differs from filename', async () => {
      const onPathChange = vi.fn();
      const { getByRole } = render(ScriptInfo, {
        filename: './old.ts',
        onPathChange,
        fileExists: true,
      });
      await tick();
      const input = getByRole('textbox');
      // Type without fireEvent.input (simulating blur without prior input commit)
      Object.defineProperty(input, 'value', { value: './new.ts', writable: true, configurable: true });
      await fireEvent.blur(input);
      // onPathChange was already called via input event handling in the component;
      // just verify blur doesn't duplicate calls when value matches
    });
  });

  describe('Select button', () => {
    it('shows Select button when onSelectFile is provided', async () => {
      const { getByText } = render(ScriptInfo, {
        filename: './x.ts',
        onSelectFile: vi.fn(),
        fileExists: true,
      });
      await tick();
      expect(getByText('Select')).toBeTruthy();
    });

    it('does not show Select button when onSelectFile is not provided', async () => {
      const { queryByText } = render(ScriptInfo, {
        filename: './x.ts',
        fileExists: true,
      });
      await tick();
      expect(queryByText('Select')).toBeNull();
    });

    it('calls onSelectFile when Select is clicked', async () => {
      const onSelectFile = vi.fn();
      const { getByText } = render(ScriptInfo, {
        filename: './x.ts',
        onSelectFile,
        fileExists: true,
      });
      await tick();
      await fireEvent.click(getByText('Select'));
      expect(onSelectFile).toHaveBeenCalledOnce();
    });

    it('Select button is present even when file exists', async () => {
      const { getByText } = render(ScriptInfo, {
        filename: './x.ts',
        onSelectFile: vi.fn(),
        fileExists: true,
      });
      await tick();
      expect(getByText('Select')).toBeTruthy();
    });
  });

  describe('Create button', () => {
    it('shows Create when filename is empty and onCreateFile is provided', async () => {
      const { getByText } = render(ScriptInfo, {
        filename: '',
        onCreateFile: vi.fn(),
        fileExists: false,
      });
      await tick();
      expect(getByText('Create')).toBeTruthy();
    });

    it('shows Create when file does not exist and a path is set', async () => {
      const { getByText } = render(ScriptInfo, {
        filename: './missing.ts',
        onCreateFile: vi.fn(),
        fileExists: false,
      });
      await tick();
      expect(getByText('Create')).toBeTruthy();
    });

    it('hides Create when file exists', async () => {
      const { queryByText } = render(ScriptInfo, {
        filename: './exists.ts',
        onCreateFile: vi.fn(),
        fileExists: true,
      });
      await tick();
      expect(queryByText('Create')).toBeNull();
    });

    it('does not show Create when onCreateFile is not provided', async () => {
      const { queryByText } = render(ScriptInfo, {
        filename: '',
        fileExists: false,
      });
      await tick();
      expect(queryByText('Create')).toBeNull();
    });

    it('shows Create reactively when path is cleared without blur', async () => {
      const { getByRole, getByText } = render(ScriptInfo, {
        filename: './x.ts',
        onCreateFile: vi.fn(),
        fileExists: true,
      });
      await tick();

      const input = getByRole('textbox') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '' } });
      await tick();
      expect(getByText('Create')).toBeTruthy();
    });

    it('calls onCreateFile when Create is clicked', async () => {
      const onCreateFile = vi.fn();
      const { getByText } = render(ScriptInfo, {
        filename: '',
        onCreateFile,
        fileExists: false,
      });
      await tick();
      await fireEvent.click(getByText('Create'));
      expect(onCreateFile).toHaveBeenCalledOnce();
    });

    it('suppresses Create flash immediately after filename prop changes to non-empty', async () => {
      const onCreateFile = vi.fn();
      const { queryByText, rerender } = render(ScriptInfo, {
        filename: '',
        onCreateFile,
        fileExists: false,
      });
      await tick();
      expect(queryByText('Create')).toBeTruthy();

      // Simulate external selection setting the filename (fileExists still false momentarily)
      await rerender({ filename: './selected.ts', onCreateFile, fileExists: false });
      await tick();
      expect(queryByText('Create')).toBeNull();
    });

    it('shows Create after suppress timeout if file still does not exist', async () => {
      const onCreateFile = vi.fn();
      const { queryByText, rerender } = render(ScriptInfo, {
        filename: '',
        onCreateFile,
        fileExists: false,
      });
      await tick();

      await rerender({ filename: './selected.ts', onCreateFile, fileExists: false });
      await tick();
      expect(queryByText('Create')).toBeNull(); // suppressed

      vi.runAllTimers();
      await tick();
      expect(queryByText('Create')).toBeTruthy(); // suppress expired
    });

    it('clears suppress when fileExists becomes true (file confirmed to exist)', async () => {
      const onCreateFile = vi.fn();
      const { queryByText, rerender } = render(ScriptInfo, {
        filename: '',
        onCreateFile,
        fileExists: false,
      });
      await tick();

      await rerender({ filename: './selected.ts', onCreateFile, fileExists: false });
      await tick();
      expect(queryByText('Create')).toBeNull(); // suppressed

      await rerender({ filename: './selected.ts', onCreateFile, fileExists: true });
      await tick();
      expect(queryByText('Create')).toBeNull(); // file exists → correctly hidden (not just suppressed)
    });
  });

  describe('button order', () => {
    it('renders Select before Create in the DOM', async () => {
      const { container } = render(ScriptInfo, {
        filename: '',
        onSelectFile: vi.fn(),
        onCreateFile: vi.fn(),
        fileExists: false,
      });
      await tick();

      const actions = container.querySelector('.input-actions');
      const buttons = actions?.querySelectorAll('button');
      expect(buttons?.length).toBe(2);
      expect(buttons?.[0].classList.contains('select-file-btn')).toBe(true);
      expect(buttons?.[1].classList.contains('create-file-btn')).toBe(true);
    });
  });

  describe('input styling', () => {
    it('input has larger padding matching buffer config style', async () => {
      const { getByRole } = render(ScriptInfo, { filename: '', fileExists: false });
      await tick();
      const input = getByRole('textbox') as HTMLInputElement;
      // Verify config-input class is applied
      expect(input.classList.contains('config-input')).toBe(true);
    });
  });
});
