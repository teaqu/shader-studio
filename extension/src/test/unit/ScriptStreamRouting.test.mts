import { describe, expect, it, vi } from 'vitest';
import type { ShaderSourceMessage } from '@shader-studio/types';

vi.mock('vscode', () => ({ workspace: { workspaceFolders: undefined, getConfiguration: () => ({get: (_key: string, fallback: unknown) => fallback}) }, commands: {executeCommand: vi.fn()} }));
vi.mock('../../app/services/Logger.js', () => ({ Logger: { getInstance: () => ({ debug: vi.fn(), warn: vi.fn() }) } }));
import { ClientMessageHandler } from '../../app/ClientMessageHandler.js';
import { ShaderProvider } from '../../app/ShaderProvider.js';

describe('script stream routing', () => {
  it('creates transport ownership and releases explicit and default owners independently', async () => {
    const provider = {
      requestScriptStreamFrame: vi.fn((session: number) => ({ session, sequence: 1, streams: [] })),
      releaseScriptStreamConsumer: vi.fn(),
    };
    const handler = new ClientMessageHandler({} as never, provider as never, {} as never, null, '/extension');
    const respond = vi.fn();
    const owner = {};
    await handler.handle({type:'requestScriptStreamFrame',payload:{session:1,request:1,consumer:'explicit'}},respond,undefined,owner);
    await handler.handle({type:'requestScriptStreamFrame',payload:{session:1,request:2,consumer:'default'}},respond);
    expect(respond).toHaveBeenCalledTimes(2);
    handler.releaseScriptStreams(owner);
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledExactlyOnceWith(1,'explicit');
    handler.releaseScriptStreams();
    expect(provider.releaseScriptStreamConsumer).toHaveBeenLastCalledWith(1,'default');
    handler.releaseScriptStreams();
    expect(provider.releaseScriptStreamConsumer).toHaveBeenCalledTimes(2);
  });
  it('forwards provider requests, queue status and teardown to the script evaluator', () => {
    const frame={session:7,sequence:9,streams:[]};
    const queues=[{name:'net',queued:5}];
    const scriptEvaluator={
      requestStreamFrame:vi.fn(()=>frame),getStreamQueues:vi.fn(()=>queues),
      releaseStreamConsumer:vi.fn(),dispose:vi.fn(),
    };
    const provider=Object.assign(Object.create(ShaderProvider.prototype),{scriptEvaluator}) as ShaderProvider;
    expect(provider.requestScriptStreamFrame(7,8,'preview')).toBe(frame);
    expect(scriptEvaluator.requestStreamFrame).toHaveBeenCalledExactlyOnceWith(7,8,'preview');
    expect(provider.requestScriptStreamFrame(7)).toBe(frame);
    expect(scriptEvaluator.requestStreamFrame).toHaveBeenLastCalledWith(7,undefined,undefined);
    expect(provider.getScriptStreamQueues(7,'preview')).toBe(queues);
    expect(scriptEvaluator.getStreamQueues).toHaveBeenCalledExactlyOnceWith(7,'preview');
    provider.releaseScriptStreamConsumer(7,'preview');
    expect(scriptEvaluator.releaseStreamConsumer).toHaveBeenCalledExactlyOnceWith(7,'preview');
    provider.dispose();
    expect(scriptEvaluator.dispose).toHaveBeenCalledOnce();
  });
  it.each([['slang',true],['glsl',false]] as const)('publishes stream metadata and sets backend capability for %s', async (language,allowStreams) => {
    const metadata=[{name:'net',maxPerFrame:4,maxQueued:8}];
    const scriptEvaluator={loadScript:vi.fn(()=>({declarations:'',uniforms:[],streams:metadata,session:7}))};
    const provider=Object.assign(Object.create(ShaderProvider.prototype),{
      scriptEvaluator,scriptBundler:{bundle:vi.fn(async()=>({success:true,code:'bundled'}))},
      getScriptPath:()=>'/project/source.js',
    }) as ShaderProvider;
    const message={} as ShaderSourceMessage;
    const bundle = Reflect.get(provider,'bundleScript') as (config: unknown, path: string, message: ShaderSourceMessage, content: string) => Promise<boolean>;
    expect(await bundle.call(provider,{script:'source.js'},`/project/image.${language}`,message,'source')).toBe(true);
    expect(scriptEvaluator.loadScript).toHaveBeenCalledExactlyOnceWith('bundled','/project/source.js',allowStreams);
    expect(message.scriptStreams).toBe(metadata);
    expect(message.scriptSession).toBe(7);
  });
});


describe('stream routing coexists with existing viewer commands', () => {
  function routing() {
    const handlers = {
      config: {handleConfigUpdate: vi.fn()},
      files: {handleSelectFile: vi.fn(), handleCreateFile: vi.fn(), handleInsertShaderSource: vi.fn(), handleRequestWorkspaceFiles: vi.fn(), handleForkShader: vi.fn(), handleSaveFile: vi.fn()},
      overlay: {handleUpdateShaderSource: vi.fn(), handleRequestFileContents: vi.fn()},
      nav: {handleNavigateToBuffer: vi.fn(), handleGoToLine: vi.fn()},
      shaderProvider: {updateScriptPollingRate: vi.fn(),resetScriptTime: vi.fn(),resendScriptValues: vi.fn(),updateScriptRuntimeState: vi.fn()},
      layoutStateStore: {save: vi.fn(),load: vi.fn(()=>({saved:true}))},
      profileHandler: {handle: vi.fn()},
    };
    const handler = Object.assign(Object.create(ClientMessageHandler.prototype), handlers, {logger:{debug:vi.fn()}}) as ClientMessageHandler;
    return {handler, ...handlers};
  }
  it.each([
    ['updateConfig','config','handleConfigUpdate'],['selectFile','files','handleSelectFile'],
    ['createFile','files','handleCreateFile'],['insertShaderSource','files','handleInsertShaderSource'],
    ['updateShaderSource','overlay','handleUpdateShaderSource'],['requestFileContents','overlay','handleRequestFileContents'],
    ['navigateToBuffer','nav','handleNavigateToBuffer'],['requestWorkspaceFiles','files','handleRequestWorkspaceFiles'],
    ['forkShader','files','handleForkShader'],['saveFile','files','handleSaveFile'],['goToLine','nav','handleGoToLine'],
  ])('routes %s to its command owner', async (type,group,method) => {
    const services = routing();const payload={id:'request'};const respond=vi.fn();
    await services.handler.handle({type,payload},respond);
    const command = Reflect.get(Reflect.get(services,group),method);
    expect(command).toHaveBeenCalledOnce();
    expect(command.mock.calls[0][0]).toBe(payload);
  });
  it('routes script state and control commands alongside streams', async () => {
    const {handler,shaderProvider}=routing();const respond=vi.fn();const state={paused:true};
    await handler.handle({type:'updateScriptPollingRate',payload:{fps:60}},respond);
    await handler.handle({type:'resetScriptTime'},respond);
    await handler.handle({type:'requestCustomUniformValues'},respond);
    await handler.handle({type:'scriptRuntimeState',payload:state},respond);
    expect(shaderProvider.updateScriptPollingRate).toHaveBeenCalledExactlyOnceWith(60);
    expect(shaderProvider.resetScriptTime).toHaveBeenCalledOnce();
    expect(shaderProvider.resendScriptValues).toHaveBeenCalledOnce();
    expect(shaderProvider.updateScriptRuntimeState).toHaveBeenCalledExactlyOnceWith(state);
  });
  it('routes layouts, extension commands, viewer settings and unknown profile messages', async () => {
    const {handler,layoutStateStore,profileHandler}=routing();const respond=vi.fn();
    await handler.handle({type:'saveLayout',payload:{layoutSlot:'preview',state:{saved:true}}},respond);
    await handler.handle({type:'requestLayout',payload:{layoutSlot:'preview'}},respond);
    expect(layoutStateStore.save).toHaveBeenCalledExactlyOnceWith('preview',{saved:true});
    expect(respond).toHaveBeenCalledWith({type:'restoreLayout',payload:{layoutSlot:'preview',state:{saved:true}}});
    for(const type of ['extensionCommand','setCompileMode','requestShaderAuthoringSettings','requestViewerCameraSettings','updateViewerCameraSettings','requestCanvasInputSettings']) {
      await handler.handle({type,payload:{command:'resetTime',mode:'automatic'}},respond);
    }
    expect(respond).toHaveBeenCalledWith({type:'viewerCameraSettings',payload:{useViewerCamera:true}});
    const message={type:'profileCommand'};
    await handler.handle(message,respond);
    expect(profileHandler.handle).toHaveBeenCalledExactlyOnceWith(message,respond);
  });
});
