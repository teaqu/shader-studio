interface ContextMenuState {
  path: string;
  x: number;
  y: number;
}

let openMenu = $state<ContextMenuState | null>(null);

export function getOpenContextMenu(): ContextMenuState | null {
  return openMenu;
}

export function openContextMenu(path: string, x: number, y: number): void {
  openMenu = { path, x, y };
}

export function positionContextMenu(x: number, y: number): void {
  if (openMenu && (openMenu.x !== x || openMenu.y !== y)) {
    openMenu = { ...openMenu, x, y };
  }
}

export function closeContextMenu(): void {
  openMenu = null;
}
