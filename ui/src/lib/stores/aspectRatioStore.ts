import { writable } from 'svelte/store';
import type { AspectRatioMode } from '@shader-studio/types';
export type { AspectRatioMode } from '@shader-studio/types';

export interface AspectRatioState {
    mode: AspectRatioMode;
}

const VALID_MODES: AspectRatioMode[] = ['16:9', '4:3', '1:1', 'fill', 'auto'];

const createAspectRatioStore = () => {
    let currentMode: AspectRatioMode = '16:9';

    const { subscribe, set, update } = writable<AspectRatioState>({
        mode: currentMode
    });

    // Load from localStorage if available
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('shader-studio-aspect-ratio');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && VALID_MODES.includes(parsed.mode)) {
                    currentMode = parsed.mode;
                    set(parsed);
                }
            } catch (e) {
                console.warn('Failed to parse stored aspect ratio setting');
            }
        }
    }

    return {
        subscribe,
        setMode: (mode: AspectRatioMode) => {
            currentMode = mode;
            update(state => {
                const newState = { ...state, mode };
                if (typeof window !== 'undefined') {
                    localStorage.setItem('shader-studio-aspect-ratio', JSON.stringify(newState));
                }
                return newState;
            });
        },
        setFromConfig: (mode?: AspectRatioMode) => {
            if (mode && VALID_MODES.includes(mode)) {
                if (currentMode === mode) { return; }
                currentMode = mode;
                set({ mode });
            }
        },
        reset: () => {
            const defaultState = { mode: '16:9' as AspectRatioMode };
            set(defaultState);
            if (typeof window !== 'undefined') {
                localStorage.setItem('shader-studio-aspect-ratio', JSON.stringify(defaultState));
            }
        }
    };
};

export const aspectRatioStore = createAspectRatioStore();

// Helper function to get aspect ratio value
export const getAspectRatio = (mode: AspectRatioMode): number | null => {
    switch (mode) {
        case '16:9':
            return 16 / 9;
        case '4:3':
            return 4 / 3;
        case '1:1':
            return 1;
        case 'fill':
            return null;
        case 'auto':
            return null;
        default:
            return 16 / 9;
    }
};

// Helper function to get display label
export const getAspectRatioLabel = (mode: AspectRatioMode): string => {
    switch (mode) {
        case '16:9':
            return '16:9 (Widescreen)';
        case '4:3':
            return '4:3 (Standard)';
        case '1:1':
            return '1:1 (Square)';
        case 'fill':
            return 'Fill Container';
        case 'auto':
            return 'Auto (Screen Ratio)';
        default:
            return mode;
    }
};
