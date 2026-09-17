// Each channel is one agreement between the script's context and the renderer's
// own uniforms: red for resolution, green for time, blue for mouse. White means
// the script sees the shader the viewer is actually showing.
fn mainImage(fragCoord: vec2f) -> vec4f {
    let sameWidth = select(0.0, 1.0, abs(uWidth - iResolution.x) < 1.0);
    let sameTime = select(0.0, 1.0, abs(uTime - iTime) < 0.75);
    let sameMouse = select(0.0, 1.0, abs(uMouseX - iMouse.x) < 4.0);
    return vec4f(sameWidth, sameTime, sameMouse, 1.0);
}
