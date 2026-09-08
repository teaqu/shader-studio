// Each channel is one agreement between the script's context and the renderer's
// own uniforms: red for resolution, green for time, blue for mouse. White means
// the script sees the shader the viewer is actually showing.
void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float sameWidth = abs(uWidth - iResolution.x) < 1.0 ? 1.0 : 0.0;
    float sameTime = abs(uTime - iTime) < 0.75 ? 1.0 : 0.0;
    float sameMouse = abs(uMouseX - iMouse.x) < 4.0 ? 1.0 : 0.0;
    fragColor = vec4(sameWidth, sameTime, sameMouse, 1.0);
}
