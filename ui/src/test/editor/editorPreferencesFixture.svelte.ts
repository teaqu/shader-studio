import type { HostEditorPreferences } from '../../lib/state/hostState.svelte';

let preferences = $state<HostEditorPreferences>({ fontSize: 14, tabSize: 2, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on' });

export function getFixturePreferences(): HostEditorPreferences {
  return preferences;
}

export function setFixturePreferences(value: HostEditorPreferences): void {
  preferences = value;
}
