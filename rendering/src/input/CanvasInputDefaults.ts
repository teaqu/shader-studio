/** The canvas owner supplies the live global preference through its DOM attribute. */
export function preventCanvasMouseDefault(canvas: HTMLCanvasElement | null, event: Event): void {
  if (canvas && canvas.dataset?.preventMouseDefaults !== 'false') {
    event.preventDefault();
  }
}
