# Intentional backend differences

These fixtures characterize differences that are not functional-parity bugs.

| Fixture | Expected difference |
| --- | --- |
| `precision/*` | Slang/WebGPU uses 32-bit float targets when `float32-filterable` is supported, matching GLSL. On adapters without that optional feature it falls back to 16-bit, so numerically sensitive accumulation may diverge. |
