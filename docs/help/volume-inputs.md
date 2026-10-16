# Volume / 3D Texture Inputs

A volume texture stores values throughout a 3D grid. Use one for cloud density, 3D noise, or a color field that your shader samples with an X, Y, and Z coordinate. Volume inputs work in GLSL, Slang, and WGSL.

## Load a Volume

**Random Greyscale.ktx2** and **Random RGBA.ktx2** are built into Shader Studio in standalone and VS Code. Open **Volumes** and select either one to use 32 × 32 × 32 random noise without downloading a file.

1. In VS Code, put a supported `.ktx2` volume file in your shader workspace. To try the example below, download the [axis-ramp sample](../assets/volume-input/axis-ramp.ktx2) into the same folder as your shader.
2. Open **Config**, select the pass, and add or configure a channel such as `iChannel0`.
3. Select **Volumes** and choose the file. You can also enter its path.
4. Choose **Linear** filtering for smooth transitions between voxels (3D pixels), or **Nearest** to read individual voxels.
5. Set **Wrap X / Y / Z** to **Repeat** for a tiling volume, or **Clamp** to keep coordinates outside the volume at its edges.

The preview shows the volume's dimensions. Drag the 3D preview to rotate it, use **+ / −** to zoom, or **Reset view** to restore the camera. Switch to **Slices** to inspect individual layers along X, Y, or Z.

The density preview shows R8 data as grayscale. For RGBA data, alpha controls density and RGB controls color. Your shader can interpret the same data differently, so its lighting and appearance may differ from the preview.

## Try an Animated Slice

Configure `iChannel0` with the axis-ramp sample, **Linear** filtering, and **Clamp** wrapping. Paste the matching example into a Built-in image shader. You should see a red/green gradient whose blue component changes as the sampled depth moves over time.

=== "GLSL"
    ```glsl
    void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        vec2 uv = fragCoord / iResolution.xy;
        float depth = 0.5 + 0.5 * sin(iTime);
        fragColor = texture(iChannel0, vec3(uv, depth));
    }
    ```

=== "Slang"
    ```slang
    float4 mainImage(float2 fragCoord) {
        float2 uv = fragCoord / iResolution.xy;
        float depth = 0.5 + 0.5 * sin(iTime);
        return iChannel0.SampleLevel(float3(uv, depth), 0.0);
    }
    ```

=== "WGSL"
    ```wgsl
    fn mainImage(coord: vec2f) -> vec4f {
        let uv = coord / iResolution.xy;
        let depth = 0.5 + 0.5 * sin(iTime);
        return iChannel0SampleLevel(vec3f(uv, depth), 0.0);
    }
    ```

The three sample coordinates run from 0 to 1 across the volume. Read its width, height, and depth with GLSL `iCh0.size`, Slang `iChannel0.size`, or WGSL `iChannel0.size` (also available as `iChannel0Size()`). Named channels work too: a Slang channel named `density` is sampled with `density.SampleLevel(...)`; WGSL uses `densitySampleLevel(...)`.

## Sample Volumes

The two noise volumes are also available in the built-in list. Download these files to use them as workspace assets:

| Sample | Contents | Suggested settings |
| --- | --- | --- |
| [Axis ramp](../assets/volume-input/axis-ramp.ktx2) | X, Y, and Z stored as red, green, and blue; useful for checking coordinates | Linear, Clamp |
| [Cloud density](../assets/volume-input/cloud-density.ktx2) | A 48 × 48 × 48 grayscale density field | Linear, Clamp |
| [Grayscale noise](../assets/volume-input/noise-grey.ktx2) | A 32 × 32 × 32 random grayscale field | Linear, Repeat |
| [RGBA noise](../assets/volume-input/noise-rgba.ktx2) | A 32 × 32 × 32 field with independent random values in each component | Linear, Repeat |

For a grayscale file, sample `.r` and use it for all three color components. For example, replace the last line of the GLSL example with:

```glsl
float density = texture(iChannel0, vec3(uv, depth)).r;
fragColor = vec4(vec3(density), 1.0);
```

The noise files can replace Shadertoy-style 3D noise inputs, but contain different values, so the resulting pattern will differ. With **Linear** and **Repeat**, sampling at several scales can produce repeating fractal noise. These are random-value grids, not Perlin or Worley noise.

The sample files are original assets provided under the [MIT license](../assets/volume-input/LICENSE.txt).

## Supported Files and Limits

- Use uncompressed 3D KTX2 with linear `R8_UNORM` or `R8G8B8A8_UNORM` data. Non-cubic dimensions are supported.
- Arrays, cubemaps, compressed KTX2, floating-point formats, sRGB data, and custom channel swizzles are unsupported.
- Only the highest-resolution texture level is sampled. Additional mip levels do not affect rendering.
- The volume must fit your device's maximum 3D texture dimensions and a 256 MiB limit measured as four bytes per voxel.
- These are inputs loaded from files. Shaders cannot generate 3D volume outputs.

For exported data, store voxels with X changing fastest, then Y, then Z. Shader Studio does not flip Y or reinterpret the data based on `KTXorientation`. Red-only volumes return `(r, 0, 0, 1)` when sampled.

Convert simulation data such as OpenVDB to a supported dense KTX2 grid before loading it. Shadertoy BIN volume files also require conversion to KTX2.

If loading fails, check the message for an unsupported format, size limit, or missing file. The channel reports that it is not loaded and may sample opaque black until you choose a valid file. Check GLSL `iCh0.loaded != 0`, Slang `iChannel0.loaded`, or WGSL `iChannel0.loaded` when your shader needs to handle a missing volume.

## Config File Example

The Config panel saves your choices automatically. If you edit `.sha.json` yourself, an Image pass with a volume input looks like this:

```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": {
          "type": "volume",
          "path": "./axis-ramp.ktx2",
          "filter": "linear",
          "wrap": "clamp"
        }
      }
    }
  }
}
```

See [Channels](../features/channels.md) for other input types and channel naming.
