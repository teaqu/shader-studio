void mainImage(out vec4 c, in vec2 p)
{
    // Zero and one are represented exactly by both rgba16f and rgba32f.
    // Alternating every frame makes a previous-frame read fail deterministically.
    float marker = float(iFrame & 1);
    c = vec4(marker, 0.0, 0.0, 1.0);
}
