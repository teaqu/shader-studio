import { writable } from 'svelte/store';

export type Theme = 'light' | 'dark';

const savedTheme = (typeof localStorage !== 'undefined' && localStorage.getItem('shadera-theme')) as Theme | null;
const defaultTheme: Theme = savedTheme || 'light';

export const currentTheme = writable<Theme>(defaultTheme);

export function applyTheme(theme: Theme) {
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('shadera-theme', theme);
        }
    }
}

export function toggleTheme() {
    currentTheme.update(theme => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
        return newTheme;
    });
}

if (typeof document !== 'undefined') {
    applyTheme(defaultTheme);
}
