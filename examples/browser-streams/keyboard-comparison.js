// Browser-only keyboard source. Focus the shader canvas; editor typing is excluded.
export function streams(ctx) {
  const keyboardEvents = ctx.stream({ maxPerFrame: 512, maxQueued: 65536 });
  const pending = [];
  let sequence = 0;
  function drain() {
    while (pending.length && keyboardEvents.push(pending[0])) pending.shift();
  }
  function emit(kind, codepoint, event) {
    const code = event.code || '';
    const physical = code.startsWith('Key') ? code.charCodeAt(3) : ({Space:32,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40})[code] || 0;
    const modifiers = (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0);
    if (pending.length >= 8192) throw Error('Keyboard source queue full; resume or restart the preview');
    pending.push([kind,codepoint,physical,modifiers,Math.floor(event.timeStamp) >>> 0,sequence++ >>> 0,0,0]);
    drain();
  }
  const stop = ctx.onKeyboard(event => {
    if (event.type === 'release_all') { emit(5,0,event); return; }
    if (event.type === 'text') {
      for (const scalar of event.text || '') emit(4,scalar.codePointAt(0),event);
      return;
    }
    const scalar = Array.from(event.key || '');
    const codepoint = scalar.length === 1 ? scalar[0].codePointAt(0) : 0;
    emit(event.type === 'keyup' ? 2 : event.repeat ? 3 : 1,codepoint,event);
    if (event.type === 'keydown' && codepoint && !event.ctrlKey && !event.metaKey && !event.isComposing) emit(4,codepoint,event);
  });
  const timer = setInterval(drain,16);
  ctx.onDispose(() => {stop();clearInterval(timer);pending.length=0;});
  return { keyboardEvents };
}
