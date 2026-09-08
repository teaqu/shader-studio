// The script is fine; the shader is not. The Script tab must report the script,
// not the shader's separate misfortune.
void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float broken = ;
    fragColor = vec4(uGood, 0.0, 0.0, 1.0);
}
