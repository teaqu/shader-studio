import { vertexPassKey } from '@shader-studio/types';
import type { WgslProjectTraceRequest, WgslProjectTraceTarget, WgslTraceRecording } from '@shader-studio/types';
import type { RenderPassNode, StorageBindingNode } from '../types/PassGraph';
import type { SlangChannelResource } from '../webgpu/SlangPassPipeline';
import { captureWgslProjectTrace, captureWgslProjectReference, type WgslProjectTraceSnapshot } from './WgslProjectTraceCapture';

export interface WgslTraceProject {
  path: string;
  buffers: Record<string, string>;
  slangSourcePaths?: Record<string, string>;
}

export function wgslTraceTargets(passes: readonly RenderPassNode[], project: WgslTraceProject | null): WgslProjectTraceTarget[] {
  if (!project) {
    return [];
  }
  return passes.flatMap(pass => {
    const target = { passName: pass.name, stage: pass.kind === 'compute' ? 'compute' as const : 'fragment' as const,
      path: project.slangSourcePaths?.[pass.name] ?? (pass.name === 'Image' ? project.path : resolveSourcePath(project.path, pass.path ?? `${pass.name}.wgsl`)),
      source: pass.source, width: pass.width, height: pass.height, entryPoint: pass.entryPoint };
    return [target, ...(pass.vertexSrc ? [{ ...target, stage: 'vertex' as const,
      path: project.slangSourcePaths?.[vertexPassKey(pass.name)] ?? resolveSourcePath(project.path, `${pass.name}.vert.wgsl`), source: pass.vertexSrc }] : [])];
  });
}

export async function captureInstalledWgslTrace(
  snapshot: WgslProjectTraceSnapshot,
  target: WgslProjectTraceTarget,
  request: WgslProjectTraceRequest,
  signal: AbortSignal | undefined,
  isCurrent: () => boolean,
  reference = false,
): Promise<WgslTraceRecording> {
  // The target is authoritative after validation: callers may omit `stage`
  // for Image traces, but a selected vertex target must not fall back to the
  // fragment path merely because the request used its default.
  const capture = reference ? captureWgslProjectReference : captureWgslProjectTrace;
  const recording = await capture(snapshot, { ...request, stage: target.stage }, signal);
  if (!isCurrent()) {
    throw new Error('The shader project changed during capture. Start a new trace.');
  }
  return { ...recording, path: target.path, source: target.source, sources: [
    { path: snapshot.sourcePath, source: snapshot.pass.source },
    ...(snapshot.commonPath ? [{ path: snapshot.commonPath, source: snapshot.commonCode }] : []),
    ...(snapshot.vertexPath && snapshot.pass.vertexSrc ? [{ path: snapshot.vertexPath, source: snapshot.pass.vertexSrc }] : []),
  ] };
}

export function validateProjectTraceRequest(request: WgslProjectTraceRequest, targets: readonly WgslProjectTraceTarget[]): WgslProjectTraceTarget {
  const target = targets.find(candidate => candidate.passName === request.passName
    && candidate.stage === (request.stage ?? candidate.stage));
  if (!target) {
    throw new Error('Select an installed WGSL pass to trace.');
  }
  if (!Number.isInteger(request.capacity) || request.capacity < 1 || request.capacity > 16384) {
    throw new Error('Trace capacity must be an integer from 1 to 16384.');
  }
  if (!Array.isArray(request.pixel) || request.pixel.length !== 2
    || request.pixel.some((value, axis) => !Number.isInteger(value) || value < 0 || value >= (axis ? target.height : target.width))) {
    throw new Error('Select a pixel inside the traced pass resolution.');
  }
  if (request.invocation && (request.invocation.length !== 3 || request.invocation.some(value => !Number.isInteger(value) || value < 0))) {
    throw new Error('Trace invocation must contain three nonnegative integers.');
  }
  if (request.vertexIndex !== undefined && (!Number.isInteger(request.vertexIndex) || request.vertexIndex < 0)) {
    throw new Error('Trace vertex index must be a nonnegative integer.');
  }
  return target;
}

export function traceDispatchUniforms(count: number): ArrayBuffer[] {
  return Array.from({ length: count }, (_, index) => new Int32Array([index, 0, 0, 0]).buffer);
}

function resolveSourcePath(root: string, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^[a-z]+:\/\//i.test(path)) {
    return path;
  }
  const result: string[] = [];
  for (const segment of `${root.replace(/[^\\/]*$/, '')}${path}`.replace(/\\/g, '/').split('/')) {
    if (segment === '..') {
      result.pop();
    } else if (segment !== '.') {
      result.push(segment);
    }
  }
  return result.join('/');
}

export type WgslTraceResourceResolver = (pass: RenderPassNode) => SlangChannelResource[] | null;
export type WgslTraceStorage = Map<string, StorageBindingNode>;
