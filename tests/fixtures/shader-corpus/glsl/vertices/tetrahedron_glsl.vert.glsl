const vec3 corners[4] = vec3[4](vec3(1, 1, 1), vec3(1, -1, -1), vec3(-1, 1, -1), vec3(-1, -1, 1));
const int faces[12] = int[12](0, 1, 2,  0, 3, 1,  0, 2, 3,  1, 3, 2);

vec3 spin(vec3 p) {
    float c = cos(iTime * 0.5);
    float s = sin(iTime * 0.5);
    return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
    int face = vertexIndex / 3;
    vec3 a = corners[faces[face * 3]];
    vec3 b = corners[faces[face * 3 + 1]];
    vec3 c = corners[faces[face * 3 + 2]];
    position = spin(corners[faces[vertexIndex]] * 0.6);
    normal = spin(normalize(cross(b - a, c - a)));
}
