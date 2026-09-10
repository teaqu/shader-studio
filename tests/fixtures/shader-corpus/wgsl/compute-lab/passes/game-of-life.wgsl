// ComputeLife for WGSL/WebGPU: reads the previous frame from iChannel0
// (itself) and writes the next generation.
// WGSL mirror of ../slang/compute-lab/passes/game-of-life.slang.
// Each workgroup evolves an 8 by 8 tile of cells.

fn cellAt(cell: vec2i, size: vec2u) -> u32 {
    let x = (cell.x + i32(size.x)) % i32(size.x);
    let y = (cell.y + i32(size.y)) % i32(size.y);
    let uv = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(size);
    return select(0u, 1u, iChannel0SampleLevel(uv, 0.0).r > 0.5);
}

fn gosperGliderGun(cell: vec2u) -> u32 {
    let x = i32(cell.x) - 30;
    let y = i32(cell.y) - 12;
    let alive = (x == 1 && (y == 5 || y == 6)) || (x == 2 && (y == 5 || y == 6))
        || (x == 11 && (y == 5 || y == 6 || y == 7)) || (x == 12 && (y == 4 || y == 8))
        || (x == 13 && (y == 3 || y == 9)) || (x == 14 && (y == 3 || y == 9))
        || (x == 15 && y == 6) || (x == 16 && (y == 4 || y == 8))
        || (x == 17 && (y == 5 || y == 6 || y == 7)) || (x == 18 && y == 6)
        || (x == 21 && (y == 3 || y == 4 || y == 5)) || (x == 22 && (y == 3 || y == 4 || y == 5))
        || (x == 23 && (y == 2 || y == 6)) || (x == 25 && (y == 1 || y == 2 || y == 6 || y == 7))
        || (x == 35 && (y == 3 || y == 4)) || (x == 36 && (y == 3 || y == 4));
    return select(0u, 1u, alive);
}

@compute @workgroup_size(8, 8, 1)
fn lifeStep(@builtin(global_invocation_id) tid: vec3u) {
    let size = vec2u(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y) {
        return;
    }

    let cell = tid.xy;
    if (iFrame == 0) {
        writeOutput(cell, vec4f(f32(gosperGliderGun(cell)), 0.0, 0.0, 1.0));
        return;
    }

    let c = vec2i(cell);
    let neighbours = cellAt(c + vec2i(-1, -1), size) + cellAt(c + vec2i(0, -1), size)
        + cellAt(c + vec2i(1, -1), size) + cellAt(c + vec2i(-1, 0), size)
        + cellAt(c + vec2i(1, 0), size) + cellAt(c + vec2i(-1, 1), size)
        + cellAt(c + vec2i(0, 1), size) + cellAt(c + vec2i(1, 1), size);
    let alive = cellAt(c, size);
    let next = select(0u, 1u, neighbours == 3u || (alive == 1u && neighbours == 2u));
    writeOutput(cell, vec4f(f32(next), 0.0, 0.0, 1.0));
}
