export interface DragScrubOptions {
  step: number;
  onInput: (value: number) => void;
}

export function dragScrub(node: HTMLInputElement, options: DragScrubOptions) {
  let startX: number;
  let startValue: number;
  let dragging = false;
  let moved = false;

  function getStep() {
    return options.step;
  }

  function getMin(): number {
    const attr = node.getAttribute('min');
    return attr !== null ? parseFloat(attr) : -Infinity;
  }

  function getMax(): number {
    const attr = node.getAttribute('max');
    return attr !== null ? parseFloat(attr) : Infinity;
  }

  function onMouseDown(e: MouseEvent) {
    startX = e.clientX;
    startValue = parseFloat(node.value) || 0;
    dragging = true;
    moved = false;
    node.style.cursor = 'ew-resize';
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;

    const dx = e.clientX - startX;
    const pixelsPerStep = 4;
    const steps = Math.round(dx / pixelsPerStep);

    if (steps !== 0) {
      moved = true;
    }

    const step = getStep();
    let newValue = startValue + steps * step;

    // Clamp to min/max
    newValue = Math.max(getMin(), Math.min(getMax(), newValue));

    // Round to step precision
    const decimals = step.toString().split('.')[1]?.length || 0;
    newValue = parseFloat(newValue.toFixed(decimals));

    node.value = String(newValue);
    options.onInput(newValue);
  }

  function onMouseUp() {
    dragging = false;
    node.style.cursor = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    // If no drag occurred, allow normal click focus/select
    if (!moved) {
      node.focus();
      node.select();
    }
  }

  node.addEventListener('mousedown', onMouseDown);

  return {
    update(newOptions: DragScrubOptions) {
      options = newOptions;
    },
    destroy() {
      node.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      node.style.cursor = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
  };
}
