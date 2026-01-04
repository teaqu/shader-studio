import { writable, type Writable } from 'svelte/store';
import type { ShaderFile } from '../types/ShaderFile';

export const shadersStore: Writable<ShaderFile[]> = writable([]);
export const selectedShader: Writable<ShaderFile | null> = writable(null);
export const searchQuery: Writable<string> = writable('');
