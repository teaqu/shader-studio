// ComputeLife reads the previous frame from iChannel0 and writes the next one.
// [numthreads(8, 8, 1)] means each workgroup evolves an 8 by 8 tile of cells.

uint cellAt(int2 cell, uint2 size)
{
    int x = (cell.x + int(size.x)) % int(size.x);
    int y = (cell.y + int(size.y)) % int(size.y);
    float2 uv = (float2(x, y) + 0.5) / float2(size);
    return sampleIChannel0(uv).r > 0.5 ? 1u : 0u;
}

uint gosperGliderGun(uint2 cell)
{
    int x = int(cell.x) - 30;
    int y = int(cell.y) - 12;
    bool alive = (x == 1 && (y == 5 || y == 6)) || (x == 2 && (y == 5 || y == 6))
        || (x == 11 && (y == 5 || y == 6 || y == 7)) || (x == 12 && (y == 4 || y == 8))
        || (x == 13 && (y == 3 || y == 9)) || (x == 14 && (y == 3 || y == 9))
        || (x == 15 && y == 6) || (x == 16 && (y == 4 || y == 8))
        || (x == 17 && (y == 5 || y == 6 || y == 7)) || (x == 18 && y == 6)
        || (x == 21 && (y == 3 || y == 4 || y == 5)) || (x == 22 && (y == 3 || y == 4 || y == 5))
        || (x == 23 && (y == 2 || y == 6)) || (x == 25 && (y == 1 || y == 2 || y == 6 || y == 7))
        || (x == 35 && (y == 3 || y == 4)) || (x == 36 && (y == 3 || y == 4));
    return alive ? 1u : 0u;
}

[shader("compute")]
[numthreads(8, 8, 1)]
void lifeStep(uint3 tid : SV_DispatchThreadID)
{
    uint2 size = uint2(iResolution.xy);
    if (tid.x >= size.x || tid.y >= size.y)
    {
        return;
    }

    uint2 cell = tid.xy;
    if (iFrame == 0)
    {
        writeOutput(cell, float4(float(gosperGliderGun(cell)), 0.0, 0.0, 1.0));
        return;
    }

    int2 c = int2(cell);
    uint neighbours = cellAt(c + int2(-1, -1), size) + cellAt(c + int2(0, -1), size)
        + cellAt(c + int2(1, -1), size) + cellAt(c + int2(-1, 0), size)
        + cellAt(c + int2(1, 0), size) + cellAt(c + int2(-1, 1), size)
        + cellAt(c + int2(0, 1), size) + cellAt(c + int2(1, 1), size);
    uint alive = cellAt(c, size);
    uint next = neighbours == 3u || (alive == 1u && neighbours == 2u) ? 1u : 0u;
    writeOutput(cell, float4(float(next), 0.0, 0.0, 1.0));
}
