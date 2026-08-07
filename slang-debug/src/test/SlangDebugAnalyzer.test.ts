import { describe, expect, it } from "vitest";
import type { DebugSourcePosition } from "@shader-studio/types";
import { analyzeSlangSite } from "../SlangDebugAnalyzer";
import { createSlangWorkspace } from "../SlangWorkspace";
import * as fs from "fs";

const source = "float4 main(float2 uv) {\n"
  + "  float value = uv.x;\n"
  + "  half unsupported = half(0);\n"
  + "  if (value > 0.0) {\n"
  + "    float value = 2.0;\n"
  + "    value = value + 1.0;\n"
  + "  }\n"
  + "  return value;\n"
  + "}\n";

function analyze(position: DebugSourcePosition) {
  const created = createSlangWorkspace({
    rootUri: "/work/main.slang", rootPath: "/work/main.slang", passName: "Image", contentHash: "hash",
    files: [{ uri: "/work/main.slang", path: "/work/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" }],
  });
  if (!created.ok) throw new Error(created.diagnostics[0].message);
  return analyzeSlangSite(created.workspace.filesByUri.get(created.workspace.rootUri)!, position);
}

describe("analyzeSlangSite", () => {
  it("uses lexical shadowing, capture-type bounds, and enclosing control flow", () => {
    const r = analyze({ line: 5, character: 8 });
    expect(r).toMatchObject({ ok: true, analysis: { previewValueId: "declaration:file:///work/main.slang:4:10", visibleValues: [{ name: "uv", typeName: "float2" }, { name: "value", typeName: "float" }], controlFlow: [{ kind: "if" }] } });
  });
  it("selects a direct declaration as preview and rejects unsupported type", () => {
    expect(analyze({ line: 1, character: 8 })).toMatchObject({ ok: true, analysis: { previewValueId: "declaration:file:///work/main.slang:1:8" } });
    expect(analyze({ line: 2, character: 10 })).toMatchObject({ ok: false, diagnostics: [{ code: "slang-debug-non-capturable-type" }] });
  });
  it("does not infer a standalone expression", () => {
    expect(analyze({ line: 5, character: 14 })).toMatchObject({ ok: true, analysis: { previewValueId: "declaration:file:///work/main.slang:4:10" } });
  });
  it("reports variables at braced if header", () => {
    expect(analyze({ line: 3, character: 6 })).toMatchObject({ ok: true, analysis: { visibleValues: [{ name: "uv", typeName: "float2" }, { name: "value", typeName: "float" }], controlFlow: expect.arrayContaining([expect.objectContaining({ kind: "if" })]) } });
  });
  it("reports variables at unbraced if header", () => {
    const s = "float4 fn(float2 uv) {\n  float a = uv.x;\n  if (a > 0.0)\n    a = a * 2.0;\n  return float4(a, 0.0, 0.0, 1.0);\n}\n";
    const ws = createSlangWorkspace({ rootUri: "/x.slang", rootPath: "/x.slang", passName: "Image", contentHash: "h", files: [{ uri: "/x.slang", path: "/x.slang", source: s, version: 1, moduleName: "", ownerPass: "Image" }] });
    const r = analyzeSlangSite(ws.workspace!.filesByUri.get(ws.workspace!.rootUri)!, { line: 2, character: 6 });
    expect(r).toMatchObject({ ok: true, analysis: { visibleValues: [{ name: "uv", typeName: "float2" }, { name: "a", typeName: "float" }], controlFlow: expect.arrayContaining([expect.objectContaining({ kind: "if" })]) } });
  });
  it("reports variables at for header", () => {
    const s = "float4 fn(float2 uv) {\n  float a = 0.0;\n  for (int i = 0; i < 10; i++)\n    a += float(i);\n  return float4(a, 0.0, 0.0, 1.0);\n}\n";
    const ws = createSlangWorkspace({ rootUri: "/x.slang", rootPath: "/x.slang", passName: "Image", contentHash: "h", files: [{ uri: "/x.slang", path: "/x.slang", source: s, version: 1, moduleName: "", ownerPass: "Image" }] });
    expect(analyzeSlangSite(ws.workspace!.filesByUri.get(ws.workspace!.rootUri)!, { line: 2, character: 6 })).toMatchObject({ ok: true, analysis: { controlFlow: expect.arrayContaining([expect.objectContaining({ kind: "for" })]) } });
  });
  it("reports variables at while header", () => {
    const s = "float4 fn(float2 uv) {\n  float a = 5.0;\n  while (a > 0.0)\n    a -= 1.0;\n  return float4(a, 0.0, 0.0, 1.0);\n}\n";
    const ws = createSlangWorkspace({ rootUri: "/x.slang", rootPath: "/x.slang", passName: "Image", contentHash: "h", files: [{ uri: "/x.slang", path: "/x.slang", source: s, version: 1, moduleName: "", ownerPass: "Image" }] });
    expect(analyzeSlangSite(ws.workspace!.filesByUri.get(ws.workspace!.rootUri)!, { line: 2, character: 6 })).toMatchObject({ ok: true, analysis: { controlFlow: expect.arrayContaining([expect.objectContaining({ kind: "while" })]) } });
  });
});

// ===== foundation.slang with #include/import =====
const fShader = `#language slang 2026
module foundation_workspace_image;
import lib.palette;
#include "include/tone-map.slang"

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 history = sampleIChannel0(uv).rgb;
    float3 glow = sampleIChannel1(uv).rgb;
    float3 color = foundationToneMap(history + glow * 0.75);
    color += foundationPalette(uv.x + iTime * 0.02) * 0.025;

    // Orientation contract: RED is TOP, GREEN is LEFT.
    if (uv.y > 0.985)
        color = float3(14.0, 0.0, 0.0);
    if (uv.x < 0.008)
        color = float3(0.0, 1.0, 0.0);

    return float4(color, 1.0);
}`;

const fExp: Record<number, { ok: boolean; vars?: string[] }> = {
  0:{ok:false},1:{ok:false},2:{ok:false},3:{ok:false},4:{ok:false},5:{ok:false},6:{ok:false},
  7:{ok:true,vars:["fragCoord","uv"]},8:{ok:true,vars:["fragCoord","uv","history"]},
  9:{ok:true,vars:["fragCoord","uv","history","glow"]},10:{ok:true,vars:["fragCoord","uv","history","glow","color"]},
  11:{ok:true,vars:["fragCoord","uv","history","glow","color"]},12:{ok:true,vars:["fragCoord","uv","history","glow","color"]},
  13:{ok:true,vars:["fragCoord","uv","history","glow","color"]},14:{ok:true,vars:["fragCoord","uv","history","glow","color"]},
  15:{ok:true,vars:["fragCoord","uv","history","glow","color"]},16:{ok:true,vars:["fragCoord","uv","history","glow","color"]},
  17:{ok:true,vars:["fragCoord","uv","history","glow","color"]},18:{ok:true,vars:["fragCoord","uv","history","glow","color"]},
  19:{ok:true,vars:["fragCoord","uv","history","glow","color","_dbgReturn"]},20:{ok:true,vars:["fragCoord","uv","history","glow","color","_dbgReturn"]},
};

describe("foundation.slang line coverage", () => {
  const ws = createSlangWorkspace({ rootUri:"/f.slang",rootPath:"/f.slang",passName:"Image",contentHash:"f",files:[{uri:"/f.slang",path:"/f.slang",source:fShader,version:1,moduleName:"",ownerPass:"Image"}]});
  if(!ws.ok)throw new Error(ws.diagnostics[0].message);
  const f=ws.workspace.filesByUri.get(ws.workspace.rootUri)!;
  fShader.split("\n").forEach((line,i)=>{const exp=fExp[i];if(!exp)return;
    it(`L${i} "${line.trim().slice(0,50)||"(empty)"}" → ${exp.ok?"OK":"FAIL"}`,()=>{
      const r=analyzeSlangSite(f,{line:i,character:Math.max(0,line.search(/\S/))});
      expect(r.ok).toBe(exp.ok);
      if(exp.ok&&exp.vars&&r.ok)expect(r.analysis.visibleValues.map(v=>v.name)).toEqual(exp.vars);
      if(!exp.ok)expect(r.diagnostics?.[0]?.message).toMatch(/Select a line|Not an executable/);
    });
  });
});

// ===== video_audio.slang no #include/import =====
const vaShader = `// Video + audio input parity test for Slang/WebGPU.
//
// Config: video_audio.sha.json binds a video to iChannel0 and the seamless
// PCM test tone to iChannel1. This mirrors video_audio_glsl.glsl so the two
// rendering backends should produce the same image and audio visualization.

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;

    float3 videoColor = sampleIChannel0(uv).rgb;
    float spectrum = sampleIChannel1(float2(uv.x, 0.25)).r;
    float waveform = sampleIChannel1(float2(uv.x, 0.75)).r;

    float bar = smoothstep(uv.y - 0.015, uv.y + 0.015, spectrum * 0.85);
    float waveLine = 1.0 - smoothstep(
        0.0,
        0.015,
        abs(uv.y - (0.5 + (waveform - 0.5) * 0.45))
    );

    float3 color = videoColor * 0.45;
    color += float3(0.05, 0.85, 1.0) * bar;
    color += float3(1.0, 0.95, 0.2) * waveLine;

    if (uv.x < 0.03)
    {
        color = float3(spectrum, waveform, 0.2);
    }

    return float4(color, 1.0);
}`;

const vaExp: Record<number,{ok:boolean;vars?:string[]}> = {
  0:{ok:false},1:{ok:false},2:{ok:false},3:{ok:false},4:{ok:false},5:{ok:false},6:{ok:false},7:{ok:false},
  8:{ok:true,vars:["fragCoord","uv"]},9:{ok:true,vars:["fragCoord","uv"]},
  10:{ok:true,vars:["fragCoord","uv","videoColor"]},11:{ok:true,vars:["fragCoord","uv","videoColor","spectrum"]},
  12:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform"]},13:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform"]},
  14:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar"]},
  15:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine"]},
  16:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine"]},
  17:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine"]},
  18:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine"]},
  19:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine"]},
  20:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine"]},
  21:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  22:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  23:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  24:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  25:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  26:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  27:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  28:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  29:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color"]},
  30:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color","_dbgReturn"]},
  31:{ok:true,vars:["fragCoord","uv","videoColor","spectrum","waveform","bar","waveLine","color","_dbgReturn"]},
};

describe("video_audio.slang line coverage", () => {
  const ws = createSlangWorkspace({ rootUri:"/va.slang",rootPath:"/va.slang",passName:"Image",contentHash:"va",files:[{uri:"/va.slang",path:"/va.slang",source:vaShader,version:1,moduleName:"",ownerPass:"Image"}]});
  if(!ws.ok)throw new Error(ws.diagnostics[0].message);
  const f=ws.workspace.filesByUri.get(ws.workspace.rootUri)!;
  vaShader.split("\n").forEach((line,i)=>{const exp=vaExp[i];if(!exp)return;
    it(`L${i} "${line.trim().slice(0,55)||"(empty)"}" → ${exp.ok?"OK":"FAIL"}`,()=>{
      const r=analyzeSlangSite(f,{line:i,character:Math.max(0,line.search(/\S/))});
      expect(r.ok).toBe(exp.ok);
      if(exp.ok&&exp.vars&&r.ok)expect(r.analysis.visibleValues.map(v=>v.name)).toEqual(exp.vars);
      if(!exp.ok)expect(r.diagnostics?.[0]?.message).toMatch(/Select a line|Not an executable/);
    });
  });
});

// ===== line offset unit tests (no disk files) =====
function computeOffset(processed: string, original: string): number {
  const pl = processed.split("\n"), ol = original.split("\n");
  for (let i = 0; i < ol.length; i++) {
    const t = ol[i].trim(); if (!t) continue;
    if (ol.filter((l: string) => l.trim() === t).length !== 1) continue;
    const pi = pl.findIndex((l: string) => l.trim() === t);
    if (pi >= 0 && pi !== i) return pi - i;
  }
  return 0;
}

describe("line offset computation", () => {
  it("returns 0 for identical sources", () => {
    const s = "float4 main(float2 uv)\n{\n  float x = uv.x;\n  return float4(x);\n}\n";
    expect(computeOffset(s, s)).toBe(0);
  });

  it("returns 0 when sources differ only by trailing newline", () => {
    const withNewline = "float4 main(float2 uv)\n{\n  return float4(0);\n}\n";
    const withoutNewline = "float4 main(float2 uv)\n{\n  return float4(0);\n}";
    expect(computeOffset(withNewline, withoutNewline)).toBe(0);
  });

  it("returns 0 for sources with duplicate lines like { and }", () => {
    // This was the real bug: "{ at line 1" and "{ at line 7" in the if body
    // caused findIndex to match the wrong one, producing a false -19 offset.
    const s = "float4 fn(float2 uv)\n{\n  if (uv.x > 0.0)\n  {\n    uv.x = 1.0;\n  }\n  return float4(uv, 0.0, 1.0);\n}\n";
    expect(computeOffset(s, s)).toBe(0);
  });

  it("returns 0 for sources with many duplicate blank/commented lines", () => {
    const s = "// comment\n// another\n\nfloat4 fn()\n{\n  return float4(1);\n}\n";
    expect(computeOffset(s, s)).toBe(0);
  });

  it("finds positive offset when function body is shifted down", () => {
    const orig = "// header\nfloat4 fn()\n{\n  return float4(1);\n}\n";
    const proc = "// header\n// expanded include line 1\n// expanded include line 2\nfloat4 fn()\n{\n  return float4(1);\n}\n";
    expect(computeOffset(proc, orig)).toBe(2);
  });

  it("finds positive offset even with duplicate braces", () => {
    const orig = "// header\nfloat4 fn()\n{\n  if (x)\n  {\n    x = 1;\n  }\n  return float4(1);\n}\n";
    const proc = "// header\n// expanded\n// expanded\nfloat4 fn()\n{\n  if (x)\n  {\n    x = 1;\n  }\n  return float4(1);\n}\n";
    expect(computeOffset(proc, orig)).toBe(2);
  });
});

// ===== INTEGRATION: REAL file from disk (has trailing newline!) =====
const DISK = "/Users/calum/Projects/slang-multipass-test/video_audio.slang";
const diskSrc = fs.readFileSync(DISK, "utf-8");

describe("integration: video_audio.slang from disk", () => {
  it("disk file has trailing newline (critical for line counting)", () => {
    expect(diskSrc.endsWith("\n")).toBe(true);
  });

  it("offset is 0 for identical sources even with trailing newline", () => {
    expect(computeOffset(diskSrc, diskSrc)).toBe(0);
  });

  it("offset is 0 comparing disk vs trimmed (trailing newline difference)", () => {
    // The disk source has trailing \n, vaShader template literal doesn't.
    // Make sure the offset still works when sources differ only in trailing whitespace.
    expect(computeOffset(diskSrc, diskSrc.trim())).toBe(0);
  });

  it("no negative cursor positions", () => {
    const o = computeOffset(diskSrc, diskSrc);
    diskSrc.split("\n").forEach((_, i) => expect(i + o).toBeGreaterThanOrEqual(0));
  });

  it("line 0: 'Select a line' for function signature", () => {
    const ws = createSlangWorkspace({ rootUri:DISK,rootPath:DISK,passName:"Image",contentHash:"di",files:[{uri:DISK,path:DISK,source:diskSrc,version:1,moduleName:"",ownerPass:"Image"}]});
    if(!ws.ok)throw new Error(ws.diagnostics[0].message);
    const f=ws.workspace.filesByUri.get(ws.workspace.rootUri)!;
    const r=analyzeSlangSite(f,{line:0,character:0});
    expect(r.ok).toBe(false);
    expect(r.diagnostics?.[0]?.message).toBe("Select a line to inspect variables");
  });

  it("every executable line in the disk file is debuggable", () => {
    const ws = createSlangWorkspace({ rootUri:DISK,rootPath:DISK,passName:"Image",contentHash:"di",files:[{uri:DISK,path:DISK,source:diskSrc,version:1,moduleName:"",ownerPass:"Image"}]});
    if(!ws.ok)throw new Error(ws.diagnostics[0].message);
    const f=ws.workspace.filesByUri.get(ws.workspace.rootUri)!;
    diskSrc.split("\n").forEach((line,i) => {
      const exp = vaExp[i];
      if (!exp?.ok) return; // only check lines that should be debuggable
      const r = analyzeSlangSite(f, { line: i, character: Math.max(0, line.search(/\S/)) });
      expect(r.ok).toBe(true);
      if (r.ok && exp.vars) expect(r.analysis.visibleValues.map(v => v.name)).toEqual(exp.vars);
    });
  });
});

// ===== processed source + line offset =====
const pSrc = [
  "#language slang 2026","module foundation_workspace_image;",
  "#language slang 2026","",
  "public static const float3 kFoundationWarm = float3(1.0, 0.18, 0.05);",
  "public static const float3 kFoundationCool = float3(0.04, 0.35, 1.0);","",
  "public float3 foundationPalette(float phase)","{","    float blend = 0.5 + 0.5 * sin(phase * 6.2831853);","    return lerp(kFoundationCool, kFoundationWarm, blend);","}",
  "// Textual include","static const float kWorkspaceExposure = 1.15;","",
  "float3 foundationToneMap(float3 color)","{","    return 1.0 - exp(-color * kWorkspaceExposure);","}",
  "","float4 mainImage(float2 fragCoord)","{",
  "    float2 uv = fragCoord / iResolution.xy;","    float3 history = sampleIChannel0(uv).rgb;",
  "    float3 glow = sampleIChannel1(uv).rgb;","    float3 color = foundationToneMap(history + glow * 0.75);",
  "    color += foundationPalette(uv.x + iTime * 0.02) * 0.025;","",
  "    // Orientation contract: RED is TOP, GREEN is LEFT.","    if (uv.y > 0.985)","        color = float3(14.0, 0.0, 0.0);",
  "    if (uv.x < 0.008)","        color = float3(0.0, 1.0, 0.0);","","    return float4(color, 1.0);","}",
].join("\n");

describe("processed source + line offset", () => {
  const ws = createSlangWorkspace({ rootUri:"/p.slang",rootPath:"/p.slang",passName:"Image",contentHash:"p",files:[{uri:"/p.slang",path:"/p.slang",source:pSrc,version:1,moduleName:"",ownerPass:"Image"}]});
  if(!ws.ok)throw new Error(ws.diagnostics[0].message);
  const f=ws.workspace.filesByUri.get(ws.workspace.rootUri)!;
  const off = pSrc.split("\n").findIndex(l=>l.trim()==="float4 mainImage(float2 fragCoord)") - fShader.split("\n").findIndex(l=>l.trim()==="float4 mainImage(float2 fragCoord)");

  it("computes positive offset", () => { expect(off).toBeGreaterThan(0); });

  fShader.split("\n").forEach((line,orig)=>{
    const exp = fExp[orig]; if(!exp?.ok) return;
    it(`original L${orig} → processed L${orig+off}`,()=>{
      const r=analyzeSlangSite(f,{line:orig+off,character:Math.max(0,line.search(/\S/))});
      expect(r.ok).toBe(true);
      if(r.ok&&exp.vars) for(const v of exp.vars) expect(r.analysis.visibleValues.map(x=>x.name)).toContain(v);
    });
  });
});