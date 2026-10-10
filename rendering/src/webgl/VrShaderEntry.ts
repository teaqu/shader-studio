import { stripComments } from "../util/ShaderText";

export function hasMainVr(code: string): boolean {
  return /\bvoid\s+mainVR\s*\([^)]*\)\s*\{/.test(stripComments(code));
}

/** Desktop preview of Shadertoy's mainVR ray interface (90 degree vertical FOV). */
export function buildFragmentEntry(code: string, coordinate: string, fullscreen: boolean): string {
  const hasVrEntry = hasMainVr(code);
  if (!fullscreen || !hasVrEntry) {
    return `\nvoid main() {\n mainImage(fragColor, ${coordinate});\n}`;
  }
  return `
uniform bool _ssVrPreview;
uniform bool _ssVrImmersive;
uniform vec4 _ssVrViewport;
uniform mat4 _ssVrRayTransform;
void main() {
 if (!_ssVrPreview && !_ssVrImmersive) { mainImage(fragColor, ${coordinate}); return; }
 vec2 _ssVrCoord = ${coordinate};
 if (_ssVrImmersive) {
   _ssVrCoord -= _ssVrViewport.xy;
   vec2 _ssVrNdc = 2.0 * _ssVrCoord / iResolution.xy - 1.0;
   vec3 _ssVrRay = normalize((_ssVrRayTransform * vec4(_ssVrNdc, 1.0, 0.0)).xyz);
   mainVR(fragColor, _ssVrCoord, _ssVrRayTransform[3].xyz, _ssVrRay);
   return;
 }
 vec2 _ssVrScreen = (2.0 * _ssVrCoord - iResolution.xy) / max(iResolution.y, 1.0);
 vec3 _ssVrForward = length(iCameraDir) > 0.0 ? normalize(iCameraDir) : vec3(0.0, 0.0, -1.0);
 vec3 _ssVrReferenceUp = abs(_ssVrForward.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
 vec3 _ssVrRight = normalize(cross(_ssVrForward, _ssVrReferenceUp));
 vec3 _ssVrUp = cross(_ssVrRight, _ssVrForward);
 vec3 _ssVrDirection = normalize(_ssVrForward + _ssVrScreen.x * _ssVrRight + _ssVrScreen.y * _ssVrUp);
 mainVR(fragColor, _ssVrCoord, iCameraPos, _ssVrDirection);
}`;
}
