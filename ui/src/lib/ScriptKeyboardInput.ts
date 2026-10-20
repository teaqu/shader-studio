export interface ScriptKeyboardEvent {
  type: 'keydown' | 'keyup' | 'text' | 'release_all';
  key?: string;
  code?: string;
  text?: string;
  repeat?: boolean;
  isComposing?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  timeStamp: number;
}

/** Only the focused preview canvas supplies input; editor typing stays private. */
export class ScriptKeyboardInput {
  private readonly cleanups: (() => void)[] = [];
  constructor(canvas: HTMLCanvasElement, send: (event: ScriptKeyboardEvent) => void) {
    const listen = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
      canvas.addEventListener(type, handler);
      this.cleanups.push(() => canvas.removeEventListener(type, handler));
    };
    const key = (event: KeyboardEvent) => {
      if (document.activeElement !== canvas) {
        return;
      }
      send({ type: event.type as 'keydown' | 'keyup', key: event.key, code: event.code,
        repeat: event.repeat, isComposing: event.isComposing, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
        altKey: event.altKey, metaKey: event.metaKey, timeStamp: event.timeStamp });
    };
    listen('keydown', key); listen('keyup', key);
    listen('blur', event => send({ type: 'release_all', timeStamp: event.timeStamp }));
    listen('compositionend', event => {
      if (document.activeElement === canvas && event.data) {
        send({ type: 'text', text: event.data, timeStamp: event.timeStamp });
      }
    });
    listen('paste', event => {
      if (document.activeElement !== canvas) {
        return;
      }
      const text = event.clipboardData?.getData('text/plain');
      if (text) {
        send({ type: 'text', text, timeStamp: event.timeStamp });
      }
    });
  }
  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
  }
}
