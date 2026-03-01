import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from '../../lib/types/Snippet';

// Mock the MonacoEditor Svelte component so that monaco-editor is never imported.
// vi.mock is hoisted, so this prevents the Svelte compiler from processing
// the real MonacoEditor.svelte (which would trigger monaco-editor resolution).
vi.mock('../../lib/components/MonacoEditor.svelte', () => {
    // Return an object whose default export is a Svelte 5 component.
    // In Svelte 5 compiled output, a component is a class-like object with a
    // constructor that mounts into a target. We provide the minimal shape that
    // @testing-library/svelte's `render` (and Svelte runtime) expects.
    const MockMonacoEditor = function MonacoEditor(
        this: any,
        _internals: any,
        props: Record<string, any>,
    ) {
        // no-op component – renders nothing
    } as any;
    // The Svelte 5 runtime checks for this flag to recognise compiled components
    MockMonacoEditor.prototype = {};
    return { default: MockMonacoEditor };
});

import AddSnippetModal from '../../lib/components/AddSnippetModal.svelte';

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
    return {
        name: 'Circle SDF',
        prefix: 'sdCircle',
        body: ['float sdCircle(vec2 p, float r) {', '    return length(p) - r;', '}'],
        description: 'Signed distance function for a circle',
        category: 'sdf-2d',
        isCustom: false,
        ...overrides,
    };
}

describe('AddSnippetModal', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── Rendering ──────────────────────────────────────────────────────

    it('should not render anything when isOpen is false', () => {
        const { container } = render(AddSnippetModal, {
            props: { isOpen: false },
        });

        expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    });

    it('should render the modal dialog when isOpen is true', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render form fields: Name, Prefix, Description, Code', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByLabelText('Name')).toBeInTheDocument();
        expect(screen.getByLabelText('Prefix (trigger)')).toBeInTheDocument();
        expect(screen.getByLabelText('Description')).toBeInTheDocument();
        expect(screen.getByText('Code')).toBeInTheDocument();
    });

    it('should render Save and Cancel buttons', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByText('Save')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should show the file path info', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByText('.vscode/glsl-snippets.code-snippets')).toBeInTheDocument();
    });

    it('should render the "Last line is preview only" checkbox', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByLabelText('Last line is preview only')).toBeInTheDocument();
    });

    // ── Create vs Edit mode ────────────────────────────────────────────

    it('should show "Add Custom Snippet" title when not editing', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByText('Add Custom Snippet')).toBeInTheDocument();
    });

    it('should show "Edit Snippet" title when editingSnippet is provided', () => {
        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: makeSnippet() },
        });

        expect(screen.getByText('Edit Snippet')).toBeInTheDocument();
    });

    it('should show "Update" on save button in edit mode', () => {
        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: makeSnippet() },
        });

        expect(screen.getByText('Update')).toBeInTheDocument();
    });

    it('should show "Save" on save button in create mode', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(screen.getByText('Save')).toBeInTheDocument();
    });

    // ── Pre-populated fields in edit mode ──────────────────────────────

    it('should pre-populate name field in edit mode', () => {
        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: makeSnippet({ name: 'My Function' }) },
        });

        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        expect(nameInput.value).toBe('My Function');
    });

    it('should pre-populate prefix field in edit mode', () => {
        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: makeSnippet({ prefix: 'myFunc' }) },
        });

        const prefixInput = screen.getByLabelText('Prefix (trigger)') as HTMLInputElement;
        expect(prefixInput.value).toBe('myFunc');
    });

    it('should pre-populate description field in edit mode', () => {
        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: makeSnippet({ description: 'A useful function' }) },
        });

        const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement;
        expect(descInput.value).toBe('A useful function');
    });

    it('should set previewLastLine checkbox when editing snippet with example', () => {
        render(AddSnippetModal, {
            props: {
                isOpen: true,
                editingSnippet: makeSnippet({
                    body: ['float x = 1.0;'],
                    example: ['float x = 1.0;', 'x;'],
                }),
            },
        });

        const checkbox = screen.getByLabelText('Last line is preview only') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('should not set previewLastLine checkbox when editing snippet without example', () => {
        render(AddSnippetModal, {
            props: {
                isOpen: true,
                editingSnippet: makeSnippet({
                    body: ['float x = 1.0;'],
                }),
            },
        });

        const checkbox = screen.getByLabelText('Last line is preview only') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
    });

    // ── Form validation ────────────────────────────────────────────────

    it('should have save button disabled when all fields are empty', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const saveBtn = screen.getByText('Save');
        expect(saveBtn).toBeDisabled();
    });

    it('should have save button disabled when name is empty', async () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const prefixInput = screen.getByLabelText('Prefix (trigger)');
        await fireEvent.input(prefixInput, { target: { value: 'myPrefix' } });

        // bodyText is managed by MonacoEditor (mocked) so it remains empty
        const saveBtn = screen.getByText('Save');
        expect(saveBtn).toBeDisabled();
    });

    it('should have save button disabled when prefix is empty', async () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const nameInput = screen.getByLabelText('Name');
        await fireEvent.input(nameInput, { target: { value: 'My Snippet' } });

        const saveBtn = screen.getByText('Save');
        expect(saveBtn).toBeDisabled();
    });

    it('should have save button enabled when name, prefix, and code are filled in edit mode', () => {
        render(AddSnippetModal, {
            props: {
                isOpen: true,
                editingSnippet: makeSnippet(),
            },
        });

        // In edit mode the fields are pre-populated from the snippet
        const saveBtn = screen.getByText('Update');
        expect(saveBtn).not.toBeDisabled();
    });

    // ── Cancel button ──────────────────────────────────────────────────

    it('should call onCancel when Cancel button is clicked', async () => {
        const onCancel = vi.fn();
        render(AddSnippetModal, {
            props: { isOpen: true, onCancel },
        });

        const cancelBtn = screen.getByText('Cancel');
        await fireEvent.click(cancelBtn);

        expect(onCancel).toHaveBeenCalledOnce();
    });

    // ── Escape key ─────────────────────────────────────────────────────

    it('should call onCancel when Escape key is pressed', async () => {
        const onCancel = vi.fn();
        render(AddSnippetModal, {
            props: { isOpen: true, onCancel },
        });

        const dialog = screen.getByRole('dialog');
        await fireEvent.keyDown(dialog, { key: 'Escape' });

        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('should not call onCancel for non-Escape keys', async () => {
        const onCancel = vi.fn();
        render(AddSnippetModal, {
            props: { isOpen: true, onCancel },
        });

        const dialog = screen.getByRole('dialog');
        await fireEvent.keyDown(dialog, { key: 'Enter' });

        expect(onCancel).not.toHaveBeenCalled();
    });

    // ── Save button ────────────────────────────────────────────────────

    it('should call onSave with correct data in edit mode', async () => {
        const onSave = vi.fn();
        const snippet = makeSnippet({
            name: 'Box SDF',
            prefix: 'sdBox',
            description: 'Box distance field',
            body: ['float sdBox(vec2 p, vec2 b) {', '    return length(max(abs(p)-b,0.0));', '}'],
        });

        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: snippet, onSave },
        });

        const saveBtn = screen.getByText('Update');
        await fireEvent.click(saveBtn);

        expect(onSave).toHaveBeenCalledOnce();
        expect(onSave).toHaveBeenCalledWith({
            name: 'Box SDF',
            prefix: 'sdBox',
            description: 'Box distance field',
            body: ['float sdBox(vec2 p, vec2 b) {', '    return length(max(abs(p)-b,0.0));', '}'],
            example: undefined,
            oldName: 'Box SDF',
        });
    });

    it('should not call onSave when fields are empty and save is clicked', async () => {
        const onSave = vi.fn();
        render(AddSnippetModal, {
            props: { isOpen: true, onSave },
        });

        // Button is disabled but we click it anyway
        const saveBtn = screen.getByText('Save');
        await fireEvent.click(saveBtn);

        expect(onSave).not.toHaveBeenCalled();
    });

    it('should include oldName in save data when editing an existing snippet', async () => {
        const onSave = vi.fn();
        const snippet = makeSnippet({ name: 'Original Name' });

        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: snippet, onSave },
        });

        const saveBtn = screen.getByText('Update');
        await fireEvent.click(saveBtn);

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ oldName: 'Original Name' })
        );
    });

    it('should not include oldName when editingSnippet is not provided', async () => {
        // We can't easily test a full create flow because bodyText is managed
        // by the mocked MonacoEditor and stays empty. Instead, we verify that
        // without editingSnippet the save function guard prevents the call.
        const onSave = vi.fn();
        render(AddSnippetModal, {
            props: { isOpen: true, onSave },
        });

        // Fields are empty so handleSave exits early
        const saveBtn = screen.getByText('Save');
        await fireEvent.click(saveBtn);

        expect(onSave).not.toHaveBeenCalled();
    });

    // ── Last line preview checkbox ─────────────────────────────────────

    it('should split code into body and example when previewLastLine is checked in edit mode', async () => {
        const onSave = vi.fn();
        const snippet = makeSnippet({
            name: 'Test',
            prefix: 'test',
            body: ['float x = 1.0;'],
            example: ['float x = 1.0;', 'x;'],
        });

        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: snippet, onSave },
        });

        // The snippet has an example, so previewLastLine should be true
        const checkbox = screen.getByLabelText('Last line is preview only') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);

        const saveBtn = screen.getByText('Update');
        await fireEvent.click(saveBtn);

        expect(onSave).toHaveBeenCalledOnce();
        const callData = onSave.mock.calls[0][0];
        // With previewLastLine checked, body should have last non-empty line stripped,
        // and example should contain all lines
        expect(callData.example).toEqual(['float x = 1.0;', 'x;']);
        expect(callData.body).toEqual(['float x = 1.0;']);
    });

    it('should not split code when previewLastLine is unchecked', async () => {
        const onSave = vi.fn();
        const snippet = makeSnippet({
            name: 'Test',
            prefix: 'test',
            body: ['float x = 1.0;', 'float y = 2.0;'],
        });

        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: snippet, onSave },
        });

        const checkbox = screen.getByLabelText('Last line is preview only') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);

        const saveBtn = screen.getByText('Update');
        await fireEvent.click(saveBtn);

        expect(onSave).toHaveBeenCalledOnce();
        const callData = onSave.mock.calls[0][0];
        expect(callData.body).toEqual(['float x = 1.0;', 'float y = 2.0;']);
        expect(callData.example).toBeUndefined();
    });

    it('should toggle previewLastLine checkbox', async () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const checkbox = screen.getByLabelText('Last line is preview only') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);

        await fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(true);

        await fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(false);
    });

    // ── Preview hint text ──────────────────────────────────────────────

    it('should show the preview hint text', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        expect(
            screen.getByText('Preview shows the last line of your code as a visual output')
        ).toBeInTheDocument();
    });

    // ── Form field placeholders ────────────────────────────────────────

    it('should show correct placeholder for name input', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        expect(nameInput.placeholder).toBe('My SDF Function');
    });

    it('should show correct placeholder for prefix input', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const prefixInput = screen.getByLabelText('Prefix (trigger)') as HTMLInputElement;
        expect(prefixInput.placeholder).toBe('my-sdf');
    });

    it('should show correct placeholder for description textarea', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement;
        expect(descInput.placeholder).toBe('Description of what this snippet does');
    });

    // ── Clear fields on open without editing snippet ───────────────────

    it('should have empty fields when opened without editingSnippet', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        const prefixInput = screen.getByLabelText('Prefix (trigger)') as HTMLInputElement;
        const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement;

        expect(nameInput.value).toBe('');
        expect(prefixInput.value).toBe('');
        expect(descInput.value).toBe('');
    });

    // ── Modal aria attributes ──────────────────────────────────────────

    it('should have aria-modal attribute set to true', () => {
        render(AddSnippetModal, {
            props: { isOpen: true },
        });

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    // ── Trimming whitespace ────────────────────────────────────────────

    it('should trim whitespace from name, prefix, and description on save', async () => {
        const onSave = vi.fn();
        const snippet = makeSnippet({
            name: '  Padded Name  ',
            prefix: '  paddedPrefix  ',
            description: '  Padded description  ',
            body: ['code line'],
        });

        render(AddSnippetModal, {
            props: { isOpen: true, editingSnippet: snippet, onSave },
        });

        const saveBtn = screen.getByText('Update');
        await fireEvent.click(saveBtn);

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Padded Name',
                prefix: 'paddedPrefix',
                description: 'Padded description',
            })
        );
    });

    // ── Save disabled with whitespace-only fields ──────────────────────

    it('should treat whitespace-only name as empty for validation', () => {
        render(AddSnippetModal, {
            props: {
                isOpen: true,
                editingSnippet: makeSnippet({ name: '   ', prefix: 'valid', body: ['code'] }),
            },
        });

        const saveBtn = screen.getByText('Update');
        expect(saveBtn).toBeDisabled();
    });

    it('should treat whitespace-only prefix as empty for validation', () => {
        render(AddSnippetModal, {
            props: {
                isOpen: true,
                editingSnippet: makeSnippet({ name: 'valid', prefix: '   ', body: ['code'] }),
            },
        });

        const saveBtn = screen.getByText('Update');
        expect(saveBtn).toBeDisabled();
    });
});
