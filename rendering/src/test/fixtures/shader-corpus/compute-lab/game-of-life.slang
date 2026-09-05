// Conway's Game of Life display. Each texel of ComputeLife is one cell.
float4 mainImage(float2 fragCoord)
{
    float2 grid = float2(96.0, 54.0);
    float2 gridPosition = fragCoord / iResolution.xy * grid;
    float2 cell = floor(gridPosition);
    float alive = inputs.iChannel0.Sample((cell + 0.5) / grid).r;
    float2 withinCell = frac(gridPosition);
    float gridLine = step(min(min(withinCell.x, withinCell.y), min(1.0 - withinCell.x, 1.0 - withinCell.y)), 0.055);
    float3 dead = float3(0.02, 0.025, 0.04);
    float3 living = float3(0.2, 1.0, 0.45);
    return float4(lerp(dead, living, alive) * (1.0 - 0.35 * gridLine), 1.0);
}
