interface StorageView { selected: string; tab: 'settings' | 'inspect'; fields: Record<string, string>; }
let views = $state<Record<string, StorageView>>({});
export function getStorageView(scope: string): StorageView {
  return views[scope] ?? { selected: '', tab: 'settings', fields: {} };
}
export function selectStorageBuffer(scope: string, selected: string): void {
  views[scope] = { ...getStorageView(scope), selected };
}
export function selectStorageTab(scope: string, tab: StorageView['tab']): void {
  views[scope] = { ...getStorageView(scope), tab };
}
export function selectStorageField(scope: string, buffer: string, field: string): void {
  const view = getStorageView(scope);
  views[scope] = { ...view, fields: { ...view.fields, [buffer]: field } };
}

let pendingForms = $state<Record<string, string>>({});
export function getPendingStorageForm(scope: string): string {
  return pendingForms[scope] ?? '';
}
export function setPendingStorageForm(scope: string, form: string): void {
  pendingForms[scope] = form;
}
