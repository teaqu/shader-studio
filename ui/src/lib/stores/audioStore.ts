import { writable } from 'svelte/store';

export interface AudioState {
    volume: number;
    muted: boolean;
}

const STORAGE_KEY = 'shader-studio-audio';

/**
 * Convert a linear slider value (0-1) to a perceptual volume (0-1).
 * Uses a power curve so the slider feels more natural — most of the
 * audible range is spread across the slider instead of being crammed
 * into the bottom 10%.
 */
export function linearToPerceptualVolume(linear: number): number {
    return Math.pow(Math.max(0, Math.min(1, linear)), 3);
}

const createAudioStore = () => {
    const defaultState: AudioState = { volume: 1.0, muted: true };

    // Load from localStorage
    let initial = { ...defaultState };
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (typeof parsed.volume === 'number') {
                    initial.volume = Math.max(0, Math.min(1, parsed.volume));
                }
                if (typeof parsed.muted === 'boolean') {
                    initial.muted = parsed.muted;
                }
            } catch {
                // ignore
            }
        }
    }

    const { subscribe, set, update } = writable<AudioState>(initial);

    const persist = (state: AudioState) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: state.volume, muted: state.muted }));
        }
    };

    return {
        subscribe,
        setVolume: (volume: number) => {
            update(state => {
                const newState = { ...state, volume: Math.max(0, Math.min(1, volume)) };
                persist(newState);
                return newState;
            });
        },
        setMuted: (muted: boolean) => {
            update(state => {
                const newState = { ...state, muted };
                persist(newState);
                return newState;
            });
        },
        toggleMute: () => {
            update(state => {
                const newState = { ...state, muted: !state.muted };
                persist(newState);
                return newState;
            });
        },
    };
};

export const audioStore = createAudioStore();
