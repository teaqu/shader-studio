export const GLSL_MAIN_IMAGE_DESCRIPTION =
  "Shader Studio fragment entry point called once for each output pixel. Write the pass's RGBA output using the supplied pixel coordinate.";

export const GLSL_MAIN_IMAGE_OUTPUT_DESCRIPTION =
  "Mutable RGBA output for the current pixel. Assign its red, green, blue, and alpha components before mainImage returns.";

export const GLSL_MAIN_IMAGE_COORDINATE_DESCRIPTION =
  "Pixel-space coordinate with a lower-left origin. For mesh geometry it is derived from the interpolated UV and scaled by the pass resolution.";
