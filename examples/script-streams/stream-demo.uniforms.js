// Open stream-demo.slang in the VS Code extension or its hosted browser preview.
export function uniforms(ctx) {
  return {
    brightness: 0.8,
    tick: ctx.uint(ctx.iFrame),
    mode: ctx.int(1),
    weights: ctx.floatArray([0.25, 0.5, 0.75]),
    colors: ctx.uintArray([0xff6633, 0x33ccff]),
  };
}

export function streams(ctx) {
  const net = ctx.stream({ maxPerFrame: 128, maxQueued: 2048 });
  const uart = ctx.stream({ maxPerFrame: 64 });
  let sequence = 0;
  // Retry rejected data rather than silently dropping it.
  const timer = setInterval(() => {
    const packet = [sequence, (sequence * 37) % 256];
    if (net.push(packet)) sequence++;
  }, 50);
  uart.push([72, 101, 108, 108, 111]);
  ctx.onDispose(() => clearInterval(timer));
  return { net, uart };
}
