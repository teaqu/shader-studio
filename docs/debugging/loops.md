# Loop Control


When the debug line is inside a loop, the Loops section appears in the debug panel. It shows each enclosing loop and lets you cap the number of iterations, which is essential for debugging shaders with expensive loops.

![Loop control section](../assets/placeholders/template.svg)
_Placeholder: `debug-loop-control.png` — Loops section showing a raymarching for-loop with a max iterations input set to 10._

## Loop Detection

The debug system detects all `for` and `while` loops whose body contains the current debug line. For nested loops, all enclosing loops are shown from outermost to innermost.

Each loop displays:

- **Line number** — where the loop header starts (e.g. `L12`)
- **Loop header** — the full `for(...)` or `while(...)` statement (truncated with ellipsis if long)
- **Max iterations input** — a number input to cap execution

## Iteration Capping

Setting a max iteration value injects an early `break` into the loop body:

```glsl
// Before capping:
for (int i = 0; i < 256; i++) {
    float d = map(pos);
    pos += dir * d;
}

// After capping to 10 iterations:
int _dbgIter0 = 0;
for (int i = 0; i < 256; i++) {
    if (++_dbgIter0 > 10) break;
    float d = map(pos);
    pos += dir * d;
}
```

A counter variable (`_dbgIter{index}`) is declared before the loop and incremented as the first statement in the loop body. When the counter exceeds the cap, the loop breaks.

Setting the max iterations to **empty or 0** removes the cap and lets the loop run to its natural termination.

## Why Cap Iterations

### Raymarching Loops

Raymarching shaders often run hundreds of iterations. Without capping, debugging a variable inside the loop means the GPU executes all iterations on every cursor move. Capping to 5–20 iterations lets you see early behavior without lag.

```glsl
// Typical raymarching loop — 256 iterations is expensive to debug
for (int i = 0; i < 256; i++) {
    float d = sceneSDF(ro + rd * t);  // cursor here
    if (d < 0.001) break;
    t += d;
}
```

Cap to 10 iterations to see how `d` evolves in the first few steps.

### Accumulation Loops

Loops that accumulate values (noise octaves, blur samples) can be capped to see partial results:

```glsl
float fbm = 0.0;
float amp = 0.5;
for (int i = 0; i < 8; i++) {
    fbm += noise(p) * amp;  // cursor here
    p *= 2.0;
    amp *= 0.5;
}
```

Cap to 1 to see the first noise octave alone, then increase to see how octaves layer.

### Preventing Shader Timeouts

Some shaders have very long loops or dynamic loop bounds. Capping prevents the shader from hanging or triggering GPU timeout during debugging.

## Shadow Variables

When debugging a variable inside a loop, the debug system uses [shadow variables](inline-rendering.md#shadow-variables-in-loops) to capture the value from the **last executed iteration**. The iteration cap affects which iteration is "last" — capping to 5 means you see the value after the 5th iteration.

## Nested Loops

For nested loops, each loop has its own independent iteration cap. You can cap the outer loop to reduce total iterations while leaving the inner loop uncapped, or vice versa.

```glsl
for (int y = 0; y < 10; y++) {       // outer — cap to 3
    for (int x = 0; x < 10; x++) {   // inner — cap to 5
        float d = texture(iChannel0, vec2(x, y) / 10.0).r;  // cursor here
    }
}
```

This would execute 3 x 5 = 15 iterations instead of the full 100.

## State Behavior

- Loop iteration caps are **cleared when switching functions** to prevent stale caps from one function applying to another.
- Caps persist as you move between lines **within the same function**.
- The max iterations input supports **drag-scrub** for quick adjustment (minimum value is 1, step size is 1).
