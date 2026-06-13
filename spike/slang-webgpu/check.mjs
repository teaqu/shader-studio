// Headless verification of stages 1-3 (load slang-wasm, read .slang, compile to
// WGSL). WebGPU itself can't run in Node, but this proves the compiler path and
// lets us inspect the generated WGSL bindings. Run: node check.mjs
import createSlangModule from "./vendor/slang-wasm.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v.size === "function") {
    const out = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  }
  return [];
}

const slang = await createSlangModule();
console.log("slang-wasm loaded:", slang.getVersionString());

const source = await readFile(here("./shader.slang"), "utf8");

const globalSession = slang.createGlobalSession();
const targets = toArray(slang.getCompileTargets());
console.log("targets:", targets.map((t) => t.name).join(", "));
const wgslTarget = targets.find((t) => /wgsl/i.test(t.name));

const session = globalSession.createSession(wgslTarget.value);
const module = session.loadModuleFromSource(source, "shader", "/shader.slang");
if (!module) throw new Error("loadModuleFromSource: " + slang.getLastError().message);

const vs = module.findEntryPointByName("vertexMain");
const fs = module.findEntryPointByName("fragmentMain");
const composite = session.createCompositeComponentType([module, vs, fs]);
const linked = composite.link();
const wgsl = linked.getTargetCode(0);

console.log("\n===== GENERATED WGSL =====\n");
console.log(wgsl);
