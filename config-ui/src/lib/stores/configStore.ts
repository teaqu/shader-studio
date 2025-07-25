import { writable } from 'svelte/store';
import type { ShaderConfig } from '../types/ShaderConfig';

export const configData = writable<ShaderConfig | null>(null);
export const configError = writable<string | null>(null);
export const vscode = writable<any>(null);

// Initialize VS Code API connection
if (typeof acquireVsCodeApi !== 'undefined') {
    vscode.set(acquireVsCodeApi());
}
