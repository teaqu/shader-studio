// 32768 uint32 words every 16 ms: about 7.8 MiB/s offered load.
// Pause to fill the queue; resume to drain it. Rejected batches retry intact.
export function streams(ctx) {
  const samples = ctx.stream({maxPerFrame:65536,maxQueued:1048576});
  let sequence = 0;
  let pending = null;
  const timer = setInterval(() => {
    if (!pending) {
      pending = new Uint32Array(32768);
      for (let i=0;i<pending.length;i++) pending[i]=(sequence+i)>>>0;
    }
    if (samples.push(pending)) {sequence=(sequence+pending.length)>>>0;pending=null;}
  },16);
  ctx.onDispose(()=>clearInterval(timer));
  return {samples};
}
