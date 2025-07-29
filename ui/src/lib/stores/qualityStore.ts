import { writable } from 'svelte/store';

export type QualityMode = 'SD' | 'HD';

export interface QualityState {
    mode: QualityMode;
}

const createQualityStore = () => {
    // Default to HD
    const { subscribe, set, update } = writable<QualityState>({
        mode: 'HD'
    });

    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('shadera-quality');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && ['SD', 'HD'].includes(parsed.mode)) {
                    set(parsed);
                }
            } catch (e) {
                console.warn('Failed to parse stored quality setting');
            }
        }
    }

    return {
        subscribe,
        setMode: (mode: QualityMode) => {
            update(state => {
                const newState = { ...state, mode };
                if (typeof window !== 'undefined') {
                    localStorage.setItem('shadera-quality', JSON.stringify(newState));
                }
                return newState;
            });
        },
        reset: () => {
            const defaultState = { mode: 'HD' as QualityMode };
            set(defaultState);
            if (typeof window !== 'undefined') {
                localStorage.setItem('shadera-quality', JSON.stringify(defaultState));
            }
        }
    };
};

export const qualityStore = createQualityStore();

export const getQualityMultiplier = (mode: QualityMode): number => {
    switch (mode) {
        case 'SD':
            return 0.5;
        case 'HD':
            return 1.0;
        default:
            return 1.0;
    }
};

// Helper function to get display label
export const getQualityLabel = (mode: QualityMode): string => {
    switch (mode) {
        case 'SD':
            return 'SD (Low Quality)';
        case 'HD':
            return 'HD (High Quality)';
        default:
            return mode;
    }
};
