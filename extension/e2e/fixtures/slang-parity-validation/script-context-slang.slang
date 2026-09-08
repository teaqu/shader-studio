// Each channel is one agreement between the script's context and the renderer's
// own uniforms: red for resolution, green for time, blue for mouse. White means
// the script sees the shader the viewer is actually showing.
float4 mainImage(float2 fragCoord)
{
    float sameWidth = abs(uWidth - iResolution.x) < 1.0 ? 1.0 : 0.0;
    float sameTime = abs(uTime - iTime) < 0.75 ? 1.0 : 0.0;
    float sameMouse = abs(uMouseX - iMouse.x) < 4.0 ? 1.0 : 0.0;
    return float4(sameWidth, sameTime, sameMouse, 1.0);
}
