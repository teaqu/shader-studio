#pragma pack_matrix(row_major)
#ifdef SLANG_HLSL_ENABLE_NVAPI
#include "nvHLSLExtns.h"
#endif

#ifndef __DXC_VERSION_MAJOR
// warning X3557: loop doesn't seem to do anything, forcing loop to unroll
#pragma warning(disable : 3557)
#endif


#line 3 "/workspace/test.slang"
struct ShaderToyUniforms_0
{
    float4 resolution_0;
    float4 mouse_0;
    float time_0;
    float timeDelta_0;
    float frameRate_0;
    int frame_0;
    float4 channelTime_0;
    float4 channelLoaded_0;
    float sampleRate_0;
    float4 date_0;
    float3  channelResolution_0[int(4)];
    float4 cameraPos_0;
    float4 cameraDir_0;
};



cbuffer _st_0 : register(b0)
{
    ShaderToyUniforms_0 _st_0;
}

#line 11
[shader("vertex")]float4 vertexMain(uint vertexID_0 : SV_VertexID) : SV_POSITION
{
    float2  verts_0[int(3)] = { float2(-1.0f, -1.0f), float2(3.0f, -1.0f), float2(-1.0f, 3.0f) };
    return float4(verts_0[vertexID_0], 0.0f, 1.0f);
}


#line 1
float4 mainImage_0(float2 fragCoord_0)
{


    return float4(fragCoord_0 / _st_0.resolution_0.xyz.xy, (float2)1.0f);
}


#line 18
[shader("pixel")]float4 fragmentMain(float4 fragCoord_1 : SV_Position) : SV_TARGET
{


    return mainImage_0(float2(fragCoord_1.x, _st_0.resolution_0.y - fragCoord_1.y));
}

