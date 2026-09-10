// Conway's Game of Life display for WGSL/WebGPU.
// WGSL mirror of ../slang/compute-lab/game-of-life.slang. Each texel of
// ComputeLife is one cell; the grid overlay proves the sampling alignment.

fn mainImage(coord: vec2f) -> vec4f {
    let grid = vec2f(96.0, 54.0);
    let gridPosition = coord / iResolution.xy * grid;
    let cell = floor(gridPosition);
    let alive = iChannel0Sample((cell + 0.5) / grid).r;
    let withinCell = fract(gridPosition);
    let gridLine = step(min(min(withinCell.x, withinCell.y), min(1.0 - withinCell.x, 1.0 - withinCell.y)), 0.055);
    let dead = vec3f(0.02, 0.025, 0.04);
    let living = vec3f(0.2, 1.0, 0.45);
    return vec4f(mix(dead, living, alive) * (1.0 - 0.35 * gridLine), 1.0);
}
