// One live uniform, so the host starts its poll loop and the Script tab has a
// polling rate to change.
export function uniforms() {
  return { uLevel: (Date.now() % 2000) / 2000 };
}
