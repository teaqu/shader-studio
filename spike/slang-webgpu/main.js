// Slang -> WebGPU spike entry point.
//
// Pipeline proven here:
//   .slang file  --(slang-wasm)-->  WGSL  --(WebGPU)-->  animated quad
//
// Everything is logged to the page so a failure points at the exact stage.

import createSlangModule from "./vendor/slang-wasm.js";

const logEl = document.getElementById("log");
const gpuBadge = document.getElementById("gpu");
const wgslEl = document.getElementById("wgsl");
const canvas = document.getElementById("c");

function step(label) {
  const el = document.createElement("div");
  el.className = "step";
  el.textContent = label;
  logEl.appendChild(el);
  return {
    done: (extra) => { el.className = "step done"; if (extra) el.textContent = `${label} — ${extra}`; },
    fail: (extra) => { el.className = "step fail"; if (extra) el.textContent = `${label} — ${extra}`; },
  };
}

// slang-wasm returns plain JS arrays for getCompileTargets(), but be defensive
// in case an embind vector shows up instead.
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v.size === "function") {
    const out = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  }
  return [];
}

async function main() {
  // ---- Stage 0: WebGPU availability (the gating question for the webview) ----
  if (!navigator.gpu) {
    gpuBadge.textContent = "NOT available";
    step("navigator.gpu present").fail("WebGPU is not exposed in this runtime");
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    gpuBadge.textContent = "no adapter";
    gpuBadge.className = "badge bad";
    step("requestAdapter()").fail("navigator.gpu exists but no adapter was returned");
    return;
  }
  const device = await adapter.requestDevice();
  gpuBadge.textContent = "available";
  gpuBadge.className = "badge ok";
  step("WebGPU adapter + device").done(adapter.info?.vendor || "ok");

  // ---- Stage 1: load slang-wasm ----
  let slang;
  const s1 = step("Load slang-wasm");
  try {
    slang = await createSlangModule();
    s1.done(`Slang ${slang.getVersionString?.() ?? "?"}`);
  } catch (e) {
    s1.fail(String(e));
    return;
  }

  // ---- Stage 2: read the .slang source ----
  // Prefer a host-embedded block (the VS Code webview resource server returns an
  // empty body for unknown extensions like .slang); fall back to fetch in a
  // plain browser where the static server serves it fine.
  const s2 = step("Read shader.slang");
  let source;
  try {
    const embedded = document.getElementById("slang-src");
    source = embedded?.textContent?.trim()
      ? embedded.textContent
      : await (await fetch("./shader.slang")).text();
    s2.done(`${source.length} chars`);
  } catch (e) {
    s2.fail(String(e));
    return;
  }

  // ---- Stage 3: compile Slang -> WGSL ----
  const s3 = step("Compile Slang → WGSL");
  let wgsl;
  try {
    const globalSession = slang.createGlobalSession();
    if (!globalSession) throw new Error("createGlobalSession() returned null");

    const targets = toArray(slang.getCompileTargets());
    const wgslTarget = targets.find((t) => /wgsl/i.test(t.name));
    if (!wgslTarget) throw new Error(`No WGSL target. Available: ${targets.map((t) => t.name).join(", ")}`);

    const session = globalSession.createSession(wgslTarget.value);
    if (!session) throw new Error("createSession() returned null");

    const module = session.loadModuleFromSource(source, "shader", "/shader.slang");
    if (!module) throw new Error(`loadModuleFromSource failed: ${slang.getLastError?.().message}`);

    const vsEntry = module.findEntryPointByName("vertexMain");
    const fsEntry = module.findEntryPointByName("fragmentMain");
    if (!vsEntry || !fsEntry) throw new Error("entry point(s) not found");

    const composite = session.createCompositeComponentType([module, vsEntry, fsEntry]);
    if (!composite) throw new Error(`createCompositeComponentType failed: ${slang.getLastError?.().message}`);

    const linked = composite.link();
    if (!linked) throw new Error(`link failed: ${slang.getLastError?.().message}`);

    wgsl = linked.getTargetCode(0);
    if (!wgsl) throw new Error(`getTargetCode failed: ${slang.getLastError?.().message}`);

    wgslEl.textContent = wgsl;
    s3.done(`${wgsl.length} chars of WGSL`);
  } catch (e) {
    s3.fail(String(e));
    return;
  }

  // ---- Stage 4: build the WebGPU pipeline ----
  const s4 = step("Create WebGPU pipeline");
  let pipeline, ctx, format, uniformBuffer, bindGroup;
  try {
    ctx = canvas.getContext("webgpu");
    format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque" });

    const shaderModule = device.createShaderModule({ code: wgsl });
    // Surface WGSL compile errors instead of a silent black canvas.
    const info = await shaderModule.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === "error");
    if (errs.length) throw new Error("WGSL errors:\n" + errs.map((m) => `  L${m.lineNum}: ${m.message}`).join("\n"));

    uniformBuffer = device.createBuffer({
      size: 16, // one f32, padded to the 16-byte uniform alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vertexMain" },
      fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    s4.done();
  } catch (e) {
    s4.fail(String(e));
    return;
  }

  // ---- Stage 5: render loop ----
  step("Render loop running").done("you should see an animated gradient →");
  const start = performance.now();
  const timeData = new Float32Array(1);
  function frame() {
    timeData[0] = (performance.now() - start) / 1000;
    device.queue.writeBuffer(uniformBuffer, 0, timeData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((e) => step("Unexpected error").fail(String(e)));
