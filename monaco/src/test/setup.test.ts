import { describe, it, expect, vi, beforeEach } from 'vitest';

function createMockMonaco() {
    const registeredLanguages: { id: string }[] = [];
    return {
        languages: {
            register: vi.fn((lang: { id: string }) => {
                registeredLanguages.push(lang);
            }),
            setMonarchTokensProvider: vi.fn(),
            setLanguageConfiguration: vi.fn(),
            getLanguages: vi.fn(() => registeredLanguages),
        },
        editor: {
            defineTheme: vi.fn(),
        },
    };
}

describe('setupMonacoGlsl', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (self as any).MonacoEnvironment;
    });

    it('calls monaco.languages.register with glsl', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const monaco = createMockMonaco();

        setupMonacoGlsl(monaco as any);

        expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'glsl' });
    });

    it('calls monaco.languages.setMonarchTokensProvider', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const monaco = createMockMonaco();

        setupMonacoGlsl(monaco as any);

        expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
            'glsl',
            expect.any(Object),
        );
    });

    it('configures glsl brackets and indentation rules', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const { shaderLanguageConfiguration } = await import('../language-configuration');
        const monaco = createMockMonaco();

        setupMonacoGlsl(monaco as any);

        expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith(
            'glsl',
            shaderLanguageConfiguration,
        );
    });

    it('calls monaco.editor.defineTheme for every editor theme', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const monaco = createMockMonaco();

        setupMonacoGlsl(monaco as any);

        expect(monaco.editor.defineTheme).toHaveBeenCalledTimes(3);
        expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
            'shader-studio',
            expect.any(Object),
        );
        expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
            'shader-studio-transparent',
            expect.any(Object),
        );
        expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
            'shader-studio-transparent-light',
            expect.any(Object),
        );
    });

    it('only registers once when called twice (idempotency)', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const monaco = createMockMonaco();

        setupMonacoGlsl(monaco as any);
        setupMonacoGlsl(monaco as any);

        // register is called only once because the second call bails out early
        expect(monaco.languages.register).toHaveBeenCalledTimes(1);
        expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
        expect(monaco.editor.defineTheme).toHaveBeenCalledTimes(3);
    });

    it('sets up MonacoEnvironment worker stub on self', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const monaco = createMockMonaco();

        setupMonacoGlsl(monaco as any);

        expect((self as any).MonacoEnvironment).toBeDefined();
        expect(typeof (self as any).MonacoEnvironment.getWorker).toBe('function');

        const worker = (self as any).MonacoEnvironment.getWorker();
        expect(typeof worker.postMessage).toBe('function');
        expect(typeof worker.terminate).toBe('function');
        expect(typeof worker.addEventListener).toBe('function');
        expect(typeof worker.removeEventListener).toBe('function');
        expect(typeof worker.dispatchEvent).toBe('function');
    });

    it('does not overwrite existing MonacoEnvironment', async () => {
        const { setupMonacoGlsl } = await import('../setup');
        const monaco = createMockMonaco();
        const existingEnv = { getWorker: vi.fn() };
        (self as any).MonacoEnvironment = existingEnv;

        setupMonacoGlsl(monaco as any);

        expect((self as any).MonacoEnvironment).toBe(existingEnv);
    });
});
