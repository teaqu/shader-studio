import { writable } from 'svelte/store';

export interface MicDeviceState {
    selectedDeviceId: string | null;
    availableDevices: MediaDeviceInfo[];
}

const STORAGE_KEY = 'shader-studio-mic-device';

const createMicDeviceStore = () => {
    const { subscribe, set, update } = writable<MicDeviceState>({
        selectedDeviceId: null,
        availableDevices: [],
    });

    // Load saved device on init
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && typeof parsed.selectedDeviceId === 'string') {
                    update(state => ({ ...state, selectedDeviceId: parsed.selectedDeviceId }));
                }
            } catch (e) {
                console.warn('Failed to parse stored mic device setting');
            }
        }
    }

    return {
        subscribe,
        refreshDevices: async () => {
            if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                update(state => ({ ...state, availableDevices: audioInputs }));
            } catch (e) {
                console.warn('Failed to enumerate audio devices:', e);
            }
        },
        setDevice: (deviceId: string | null) => {
            update(state => {
                const newState = { ...state, selectedDeviceId: deviceId };
                if (typeof window !== 'undefined') {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedDeviceId: deviceId }));
                }
                return newState;
            });
        },
        reset: () => {
            set({ selectedDeviceId: null, availableDevices: [] });
            if (typeof window !== 'undefined') {
                localStorage.removeItem(STORAGE_KEY);
            }
        },
    };
};

export const micDeviceStore = createMicDeviceStore();
