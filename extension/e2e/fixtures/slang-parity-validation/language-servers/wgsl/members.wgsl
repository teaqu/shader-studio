struct Material {
    albedo: vec3f, // base colour
    rough: f32,
};

fn blend(uv: vec2f, lo: vec2f, hi: vec2f) -> f32 {
    return uv.x + lo.x + hi.x;
}

fn mainImage(pixelPosition: vec2f) -> vec4f {
    let material = Material(vec3f(0.25, 0.5, 0.75), 0.5);
    let uv = pixelPosition / iResolution.xy;
    let weight = blend(uv, max(uv, vec2f(0.0, 1.0)), vec2f(1.0));
    return vec4f(material.albedo.zyx * weight, material.rough);
}
