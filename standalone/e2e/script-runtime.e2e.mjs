import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addShaderFiles } from './workspace-store.mjs';
const example = name => name==='font.bin' ? 'data:application/octet-stream;base64,'+readFileSync(new URL('../../examples/browser-streams/font.bin',import.meta.url)).toString('base64') : readFileSync(new URL(`../../examples/browser-streams/${name}`, import.meta.url),'utf8');
async function tool(page,name,args={}) {
 return page.evaluate(async({name,args})=>JSON.parse(await window.__scriptTools.get(name).execute(args)),{name,args});
}
async function seed(page,names,extra=[]) {
 await page.addInitScript(()=>{
  const tools=new Map();window.__scriptTools=tools;
  Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(tool,options){
tools.set(tool.name,tool);options?.signal?.addEventListener('abort',()=>tools.delete(tool.name),{once:true});
},unregisterTool(name){
tools.delete(name);
}}});
 });
 await page.route('**/__script_fixture__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto('/__script_fixture__');await addShaderFiles(page,[...names.map(name=>[name,example(name)]),...extra]);await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const enabled=page.getByRole('checkbox',{name:'Enable workspace scripts',exact:true});await expect(enabled).not.toBeChecked();await enabled.check();
 await page.getByRole('checkbox',{name:'Enable WebMCP',exact:true}).check();await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__scriptTools.has('list_previews'))).toBe(true);
}
async function select(page,path) {
 const {previews}=await tool(page,'list_previews');const id=previews[0].id;
 await tool(page,'select_shader',{previewId:id,path});
 await expect.poll(async()=> {
 const state=await tool(page,'get_diagnostics',{previewId:id});return state.path===path && !state.compiling && state.compileSequence===state.renderedSequence && state.errors.length===0;
},{timeout:30000}).toBe(true);return id;
}
async function storage(page,id,name,start,count) {
 const result=await tool(page,'read_storage',{previewId:id,name,start,count});
 if(!result.storage){
throw Error(JSON.stringify(result));
}
 return [...new Uint32Array(Uint8Array.from(result.storage.bytes).buffer)];
}
test('browser scripts deliver ordered keys, repeats and Unicode to GPU storage and persist after reload',async({page},testInfo)=>{
 test.setTimeout(90000);
 await seed(page,['font.bin','keyboard-comparison.js','keyboard-comparison.slang','keyboard-comparison.sha.json','keyboard-events.buffer.slang']);
 let id=await select(page,'/keyboard-comparison.slang');
 const canvas=page.getByTestId('web-preview').locator('.canvas-container > canvas:not(.pixel-canvas-marker)');
 await storage(page,id,'keyState',0,16);
 await canvas.click();await page.keyboard.down('a');await page.keyboard.down('a');await page.keyboard.up('a');
 await expect.poll(async()=> (await storage(page,id,'keyState',0,4))[1]).toBeGreaterThan(0);
 await canvas.evaluate(element=>{
const clipboardData=new DataTransfer();clipboardData.setData('text/plain','😀');element.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true}));
});
 await expect.poll(async()=> (await storage(page,id,'keyState',0,4))[3]).toBe(0x1f600);
 expect((await storage(page,id,'keyState',10,1))[0]).toBe(0);
 await page.screenshot({path:testInfo.outputPath('browser-keyboard-comparison.png')});
 await page.reload();await expect.poll(()=>page.evaluate(()=>window.__scriptTools.has('list_previews'))).toBe(true);
 id=await select(page,'/keyboard-comparison.slang');await storage(page,id,'keyState',0,16);await canvas.click();await page.keyboard.press('b');
 await expect.poll(async()=> (await storage(page,id,'keyState',0,4))[2]).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Enable workspace scripts',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'Enable workspace scripts',exact:true}).uncheck();await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect.poll(async()=>JSON.stringify(await tool(page,'get_diagnostics',{previewId:id}))).toContain('Enable workspace scripts');
});
for (const language of ['slang','wgsl']) {
test(`high volume ${language} streams reach the GPU without sequence gaps across pause and resume`,async({page},testInfo)=>{
 test.setTimeout(90000);
 const names=language==='slang' ? ['font.bin','high-volume.js','high-volume.slang','high-volume.sha.json','high-volume.buffer.slang'] : ['high-volume.js','high-volume-wgsl.wgsl','high-volume-wgsl.sha.json','high-volume-wgsl.buffer.wgsl'];
 await seed(page,names);const path=language==='slang'?'/high-volume.slang':'/high-volume-wgsl.wgsl';const id=await select(page,path);
 await expect.poll(async()=> (await storage(page,id,'volumeState',516,2))[0],{timeout:30000}).toBeGreaterThan(1048576);
 expect((await storage(page,id,'volumeState',516,2))[1]).toBe(0);
 await tool(page,'set_playback',{previewId:id,paused:true});const before=(await storage(page,id,'volumeState',516,1))[0];
 expect((await tool(page,'get_diagnostics',{previewId:id})).paused).toBe(true);
 expect((await storage(page,id,'volumeState',516,1))[0]).toBe(before);
 await tool(page,'set_playback',{previewId:id,paused:false});await expect.poll(async()=> (await storage(page,id,'volumeState',516,1))[0]).toBeGreaterThan(before);
 expect((await storage(page,id,'volumeState',517,1))[0]).toBe(0);expect((await storage(page,id,'volumeState',256,256)).every(v=>v===0)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`browser-high-volume-${language}.png`)});
 await page.reload();await expect.poll(()=>page.evaluate(()=>window.__scriptTools.has('list_previews'))).toBe(true);
 const reloaded=await select(page,path);await expect.poll(async()=> (await storage(page,reloaded,'volumeState',516,1))[0],{timeout:30000}).toBeGreaterThan(0);
 expect((await storage(page,reloaded,'volumeState',517,1))[0]).toBe(0);
});
}

test('script editor renders JavaScript syntax colors',async({page},testInfo)=>{
 test.setTimeout(60000);
 await seed(page,['font.bin','keyboard-comparison.js','keyboard-comparison.slang','keyboard-comparison.sha.json','keyboard-events.buffer.slang']);
 await select(page,'/keyboard-comparison.slang');
 await page.locator('.dv-tab').filter({hasText:/^keyboard-comparison\.js$/}).click();
 const editor=page.locator('[data-testid="file-editor"][data-path="/keyboard-comparison.js"]');
 await expect(editor).toBeVisible();
 await expect.poll(()=>editor.locator('.view-lines span').evaluateAll(elements=>new Set(elements.filter(e=>e.textContent.trim()).map(e=>getComputedStyle(e).color)).size)).toBeGreaterThan(2);
 await page.screenshot({path:testInfo.outputPath('browser-script-highlighting.png')});
});


test('explorer thumbnails compile script uniforms and streams after opt-in and reload',async({page},testInfo)=>{
 test.setTimeout(90000);
 await seed(page,['font.bin','keyboard-comparison.js','keyboard-comparison.slang','keyboard-comparison.sha.json','keyboard-events.buffer.slang'],[
 ['explorer-uniform.glsl','void mainImage(out vec4 color, in vec2 coord) { color=vec4(brightness,0.25,0.75,1.0); }'],
 ['explorer-uniform.js','export function uniforms() { return {brightness:0.8}; }'],
 ['explorer-uniform.sha.json',JSON.stringify({version:'1.0',script:'./explorer-uniform.js',passes:{Image:{}}})],
 ['explorer-uniform.wgsl','fn mainImage(coord: vec2f) -> vec4f { return vec4f(brightness,0.25,0.75,1.0); }'],
 ]);
 await expect(page.getByRole('img',{name:'keyboard-comparison.slang',exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByRole('img',{name:'explorer-uniform.glsl',exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByRole('img',{name:'explorer-uniform.wgsl',exact:true})).toBeVisible({timeout:30000});
 for(const path of ['/explorer-uniform.glsl','/explorer-uniform.wgsl']) {
  const id=await select(page,path);
  await expect.poll(async()=> (await tool(page,'get_inputs',{previewId:id})).customUniforms.find(uniform=>uniform.name==='brightness')?.value).toBe(0.8);
 }
 await page.reload();
 await expect(page.getByRole('img',{name:'keyboard-comparison.slang',exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByRole('img',{name:'explorer-uniform.glsl',exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByRole('img',{name:'explorer-uniform.wgsl',exact:true})).toBeVisible({timeout:30000});
 await page.screenshot({path:testInfo.outputPath('browser-script-explorer.png')});
});
