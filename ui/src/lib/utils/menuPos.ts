export type MenuSide = 'below-left' | 'below-right' | 'left-of';

export function computeMenuPos(
  trigger: HTMLElement,
  menu: HTMLElement,
  side: MenuSide = 'below-left',
): { top: number; left: number } {
  const t = trigger.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 8;

  let top: number;
  let left: number;

  if (side === 'left-of') {
    left = (t.left >= m.width || t.left >= vw - t.right)
      ? t.left - m.width
      : t.right;
    top = t.top;
  } else {
    top = (vh - t.bottom >= m.height || vh - t.bottom >= t.top)
      ? t.bottom + gap
      : t.top - m.height - gap;
    if (side === 'below-right') {
      left = (t.right >= m.width || t.right >= vw - t.left)
        ? t.right - m.width
        : t.left;
    } else {
      left = (vw - t.left >= m.width || vw - t.left >= t.right)
        ? t.left
        : t.right - m.width;
    }
  }

  return {
    top: Math.max(gap, Math.min(top, vh - m.height - gap)),
    left: Math.max(gap, Math.min(left, vw - m.width - gap)),
  };
}
