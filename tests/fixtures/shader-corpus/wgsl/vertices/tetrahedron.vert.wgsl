fn spin(p: vec3f) -> vec3f {
    let c = cos(iTime * 0.5);
    let s = sin(iTime * 0.5);
    return vec3f(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
    var corners = array<vec3f, 4>(vec3f(1, 1, 1), vec3f(1, -1, -1), vec3f(-1, 1, -1), vec3f(-1, -1, 1));
    var faces = array<u32, 12>(0, 1, 2,  0, 3, 1,  0, 2, 3,  1, 3, 2);
    let face = vertexIndex / 3u;
    let a = corners[faces[face * 3u]];
    let b = corners[faces[face * 3u + 1u]];
    let c = corners[faces[face * 3u + 2u]];
    *position = spin(corners[faces[vertexIndex]] * 0.6);
    *normal = spin(normalize(cross(b - a, c - a)));
}
