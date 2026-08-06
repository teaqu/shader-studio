import * as assert from "assert";
import {
  buildSlangEditorContextModule,
  type SlangEditorContext,
} from "../../app/SlangEditorContextModule";

suite("SlangEditorContextModule", () => {
  function build(overrides: Partial<SlangEditorContext> = {}): string {
    return buildSlangEditorContextModule({
      focusedFileName: "image.slang",
      channels: [],
      customUniforms: [],
      ...overrides,
    });
  }

  test("declares the complete fixed Shader Studio Slang authoring contract", () => {
    const source = build();

    for (const declaration of [
      "public static const float3 iResolution",
      "public static const float4 iMouse",
      "public static const float iTime",
      "public static const float iTimeDelta",
      "public static const float iFrameRate",
      "public static const int iFrame",
      "public static const float4 iChannelTime",
      "public static const float4 iChannelLoaded",
      "public static const float iSampleRate",
      "public static const float4 iDate",
      "public static const float3 iChannelResolution[4]",
      "public static const float3 iCameraPos",
      "public static const float3 iCameraDir",
    ]) {
      assert.ok(source.includes(declaration), `missing ${declaration}`);
    }
    for (let slot = 0; slot < 4; slot += 1) {
      assert.ok(source.includes(`public float4 sampleIChannel${slot}(float2 uv)`));
    }
    assert.ok(source.includes("shaderStudioFocus_image"));
  });

  test("matches configured 2D and cubemap channel helper signatures", () => {
    const source = build({
      channels: [
        { slot: 0, key: "videoFeed", kind: "video" },
        { slot: 1, key: "sky", kind: "cubemap" },
      ],
    });

    assert.ok(source.includes("public Texture2D<float4> videoFeed;"));
    assert.ok(source.includes("public float4 sampleIChannel0(float2 uv)"));
    assert.ok(source.includes("public float4 sampleVideoFeed(float2 uv)"));
    assert.ok(source.includes("public TextureCube<float4> sky;"));
    assert.ok(source.includes("public float4 sampleIChannel1(float3 dir)"));
    assert.ok(source.includes("public float4 sampleSky(float3 dir)"));
    assert.ok(source.includes("public static ShaderStudioChannel2D iCh0;"));
    assert.ok(source.includes("public static ShaderStudioChannelCube iCh1;"));
    assert.ok(!source.includes("sampleIChannel1(float2 uv)"));
  });

  test("unions 2D and cubemap signatures for a common pass context", () => {
    const source = build({
      channels: [
        { slot: 0, key: "imageInput", kind: "texture" },
        { slot: 0, key: "environment", kind: "cubemap" },
      ],
    });

    assert.ok(source.includes("sampleIChannel0(float2 uv)"));
    assert.ok(source.includes("sampleIChannel0(float3 dir)"));
  });

  test("omits ambiguous direct resources and channel objects in a common context", () => {
    const source = build({
      channels: [
        { slot: 0, key: "iChannel0", kind: "texture" },
        { slot: 0, key: "iChannel0", kind: "cubemap" },
      ],
    });

    assert.ok(source.includes("sampleIChannel0(float2 uv)"));
    assert.ok(source.includes("sampleIChannel0(float3 dir)"));
    assert.ok(!source.includes("Texture2D<float4> iChannel0;"));
    assert.ok(!source.includes("TextureCube<float4> iChannel0;"));
    assert.ok(!source.includes(" iCh0;"));
  });

  test("declares all supported script uniform types and skips invalid names", () => {
    const source = build({
      customUniforms: [
        { name: "gain", type: "float" },
        { name: "offset", type: "vec2" },
        { name: "tint", type: "vec3" },
        { name: "bounds", type: "vec4" },
        { name: "enabled", type: "bool" },
        { name: "bad-name", type: "float" },
        { name: "matrix", type: "mat4" },
      ],
    });

    assert.ok(source.includes("public static const float gain"));
    assert.ok(source.includes("public static const float2 offset"));
    assert.ok(source.includes("public static const float3 tint"));
    assert.ok(source.includes("public static const float4 bounds"));
    assert.ok(source.includes("public static const bool enabled"));
    assert.ok(!source.includes("bad-name"));
    assert.ok(!source.includes("matrix"));
  });

  test("deduplicates declarations and produces deterministic channel order", () => {
    const first = build({
      channels: [
        { slot: 2, key: "noise", kind: "texture" },
        { slot: 0, key: "iChannel0", kind: "texture" },
        { slot: 2, key: "noise", kind: "texture" },
      ],
      customUniforms: [
        { name: "gain", type: "float" },
        { name: "gain", type: "float" },
      ],
    });
    const second = build({
      channels: [
        { slot: 0, key: "iChannel0", kind: "texture" },
        { slot: 2, key: "noise", kind: "texture" },
      ],
      customUniforms: [{ name: "gain", type: "float" }],
    });

    assert.strictEqual(first, second);
    assert.strictEqual(first.match(/public static const float gain/g)?.length, 1);
    assert.strictEqual(first.match(/public Texture2D<float4> noise;/g)?.length, 1);
  });
});
