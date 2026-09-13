// uLevel never changes; uTick always does. That split is the point: after the
// host's first batch it sends only values that changed, so a client that loses
// its uniform state can only get uLevel back from a full resend.
export function uniforms() {
  return { uLevel: 0.75, uTick: (Date.now() % 2000) / 2000 };
}
