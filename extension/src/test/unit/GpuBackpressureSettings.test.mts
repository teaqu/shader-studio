import { ConfigChangeClassifier } from '../../app/services/ConfigChangeClassifier.js';
import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import Ajv = require('ajv');

const workspace = vi.hoisted(() => ({ getConfiguration: vi.fn(), onDidChangeConfiguration: vi.fn() }));
vi.mock('vscode', () => ({ workspace }));
vi.mock('../../app/transport/MessageHandler.js', () => ({ MessageHandler: class {} }));
vi.mock('../../language-services/ShaderAuthoringEnvironmentProvider.js', () => ({ publishLoadedShaderProjectSnapshot: vi.fn() }));
import { Messenger } from '../../app/transport/Messenger.js';

describe('GPU settings transport', () => {
  it('attaches validated defaults, broadcasts live changes, and disposes its listener', async () => {
    let receive: (event: vscode.ConfigurationChangeEvent) => void = () => {};
    const dispose = vi.fn();
    const values: Record<string, unknown> = { 'gpuBackpressure.framesInFlight': 4, 'gpuBackpressure.stallTimeoutMs': 500 };
    workspace.getConfiguration.mockReturnValue({ get: (key: string) => values[key] });
    workspace.onDidChangeConfiguration.mockImplementation(callback => {
      receive = callback;
      return { dispose };
    });
    const errors = { setShaderConfig: vi.fn() };
    const messenger = new Messenger({} as vscode.LogOutputChannel, errors as unknown as ConstructorParameters<typeof Messenger>[1]);
    const send = vi.fn();
    messenger.addTransport({ send, close: vi.fn(), onMessage: vi.fn(), hasActiveClients: () => true });
    const message = { type: 'shaderSource', config: null, path: '/shader.glsl' };
    await messenger.send(message);
    expect(send.mock.calls[0][0].gpuBackpressureDefaults).toEqual({ framesInFlight: 4, stallTimeoutMs: 500 });
    expect(message).not.toHaveProperty('gpuBackpressureDefaults');
    receive({ affectsConfiguration: () => false } as vscode.ConfigurationChangeEvent);
    expect(send).toHaveBeenCalledTimes(1);
    values['gpuBackpressure.framesInFlight'] = 0;
    receive({ affectsConfiguration: key => key === 'shader-studio.gpuBackpressure' } as vscode.ConfigurationChangeEvent);
    expect(send).toHaveBeenLastCalledWith({ type: 'gpuBackpressureSettings', defaults: { framesInFlight: 2, stallTimeoutMs: 500 } });
    messenger.close();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

const schema = JSON.parse(readFileSync(new URL('../../../schemas/shader-config.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);
describe('GPU settings schema', () => {
  it.each([{}, { framesInFlight: 1 }, { stallTimeoutMs: 300 }, { framesInFlight: 3, stallTimeoutMs: 1 }])('accepts partial settings %j', gpuBackpressure => {
    expect(validate({ version: '1.0', passes: { Image: {} }, gpuBackpressure })).toBe(true);
  });
  it.each([null, [], 2, { framesInFlight: 0 }, { framesInFlight: 1.5 }, { stallTimeoutMs: -1 }, { stallTimeoutMs: '3' }, { unknown: 1 }])('rejects invalid settings %j', gpuBackpressure => {
    expect(validate({ version: '1.0', passes: { Image: {} }, gpuBackpressure })).toBe(false);
  });
});

describe('GPU configuration changes', () => {
  it('recompiles live settings while retaining resource reloads for structural changes', () => {
    const path = '/shader.sha.json';
    const config = { version: '1.0', passes: { Image: {} } };
    const classifier = new ConfigChangeClassifier();
    classifier.recordSentConfig(path, JSON.stringify(config));
    expect(classifier.classifyChange(path, JSON.stringify({ ...config, gpuBackpressure: { framesInFlight: 1 } }))).toBe('recompile');
    classifier.recordSentConfig(path, JSON.stringify({ ...config, gpuBackpressure: { framesInFlight: 2 } }));
    expect(classifier.classifyChange(path, JSON.stringify(config))).toBe('recompile');
    expect(classifier.classifyChange(path, JSON.stringify({ ...config, script: 'other.ts' }))).toBe('reload');
  });
});
