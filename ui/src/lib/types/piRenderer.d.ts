export interface PiRenderer {
  // Constants
  CLEAR: {
    Color: number;
    Zbuffer: number;
    Stencil: number;
  };
  
  TEXFMT: {
    C4I8: number;
    C1I8: number;
    C1F16: number;
    C4F16: number;
    C1F32: number;
    C4F32: number;
    Z16: number;
    Z24: number;
    Z32: number;
  };
  
  TEXWRP: {
    CLAMP: number;
    REPEAT: number;
  };
  
  BUFTYPE: {
    STATIC: number;
    DYNAMIC: number;
  };
  
  PRIMTYPE: {
    POINTS: number;
    LINES: number;
    LINE_LOOP: number;
    LINE_STRIP: number;
    TRIANGLES: number;
    TRIANGLE_STRIP: number;
  };
  
  RENDSTGATE: {
    WIREFRAME: number;
    FRONT_FACE: number;
    CULL_FACE: number;
    DEPTH_TEST: number;
    ALPHA_TO_COVERAGE: number;
  };
  
  TEXTYPE: {
    T2D: number;
    T3D: number;
    CUBEMAP: number;
  };
  
  FILTER: {
    NONE: number;
    LINEAR: number;
    MIPMAP: number;
    NONE_MIPMAP: number;
  };
  
  TYPE: {
    UINT8: number;
    UINT16: number;
    UINT32: number;
    FLOAT16: number;
    FLOAT32: number;
    FLOAT64: number;
  };

  // Core methods
  Initialize(gl: WebGL2RenderingContext): boolean;
  GetShaderHeaderLines(shaderType: number): number;
  CheckErrors(): void;
  Clear(flags: number, ccolor?: number[], cdepth?: number, cstencil?: number): void;
  
  // Texture methods
  CreateTexture(type: number, xres: number, yres: number, format: number, filter: number, wrap: number, buffer?: ArrayBuffer | Uint8Array | null): PiTexture | null;
  CreateTextureFromImage(type: number, image: HTMLImageElement, format: number, filter: number, wrap: number, flipY: boolean): PiTexture | null;
  SetSamplerFilter(te: PiTexture, filter: number): void;
  SetSamplerWrap(te: PiTexture, wrap: number): void;
  SetSamplerVFlip(te: PiTexture, vflip: boolean, image?: HTMLImageElement): void;
  CreateMipmaps(te: PiTexture): void;
  UpdateTexture(tex: PiTexture, x0: number, y0: number, xres: number, yres: number, buffer: ArrayBuffer | Uint8Array): void;
  UpdateTextureFromImage(tex: PiTexture, image: HTMLImageElement): void;
  DestroyTexture(te: PiTexture): void;
  AttachTextures(num: number, t0?: PiTexture | null, t1?: PiTexture | null, t2?: PiTexture | null, t3?: PiTexture | null): void;
  DettachTextures(): void;
  
  // Render target methods
  CreateRenderTarget(color0: PiTexture | null, color1: PiTexture | null, color2: PiTexture | null, color3: PiTexture | null, depth: PiTexture | null, wantZbuffer: boolean): PiRenderTarget | null;
  DestroyRenderTarget(tex: PiRenderTarget): void;
  SetRenderTarget(tex: PiRenderTarget | null): void;
  CreateRenderTargetNew(wantColor0: boolean, wantZbuffer: boolean, xres: number, yres: number, samples: number): PiRenderTarget | null;
  CreateRenderTargetCubeMap(color0: PiTexture | null, depth: PiTexture | null, wantZbuffer: boolean): PiRenderTarget | null;
  SetRenderTargetCubeMap(fbo: PiRenderTarget | null, face: number): void;
  BlitRenderTarget(dst: PiRenderTarget, src: PiRenderTarget): void;
  
  // Viewport and state methods
  SetViewport(vp: number[]): void;
  SetWriteMask(c0: boolean, c1: boolean, c2: boolean, c3: boolean, z: boolean): void;
  SetState(stateName: number, stateValue: boolean): void;
  SetMultisample(v: boolean): void;
  
  // Shader methods
  CreateShader(vsSource: string, fsSource: string): PiShader | null;
  AttachShader(shader: PiShader | null): void;
  DetachShader(): void;
  DestroyShader(tex: PiShader): void;
  GetAttribLocation(shader: PiShader, name: string): number;
  SetShaderConstantLocation(shader: PiShader, name: string): WebGLUniformLocation | null;
  SetShaderConstantMat4F(uname: string, params: number[], istranspose: boolean): boolean;
  SetShaderConstant1F_Pos(pos: WebGLUniformLocation, x: number): boolean;
  SetShaderConstant1FV_Pos(pos: WebGLUniformLocation, x: Float32Array): boolean;
  SetShaderConstant1F(uname: string, x: number): boolean;
  SetShaderConstant1I(uname: string, x: number): boolean;
  SetShaderConstant2F(uname: string, x: number[]): boolean;
  SetShaderConstant3F(uname: string, x: number, y: number, z: number): boolean;
  SetShaderConstant1FV(uname: string, x: number[]): boolean;
  SetShaderConstant3FV(uname: string, x: number[]): boolean;
  SetShaderConstant4FV(uname: string, x: number[]): boolean;
  SetShaderTextureUnit(uname: string, unit: number): boolean;
  
  // Buffer/Array methods
  CreateVertexArray(data: Float32Array, mode: number): PiVertexArray | null;
  CreateIndexArray(data: Uint16Array | Uint32Array, mode: number): PiIndexArray | null;
  DestroyArray(tex: PiVertexArray | PiIndexArray): void;
  AttachVertexArray(tex: PiVertexArray, attribs: PiVertexAttribs, pos: number): void;
  AttachIndexArray(tex: PiIndexArray): void;
  DetachVertexArray(tex: PiVertexArray, attribs: PiVertexAttribs): void;
  DetachIndexArray(tex: PiIndexArray): void;
  
  // Drawing methods
  DrawPrimitive(typeOfPrimitive: number, num: number, useIndexArray: boolean, numInstances: number): void;
  DrawFullScreenTriangle_XY(vpos: number): void;
  DrawUnitQuad_XY(vpos: number): void;
  DrawUnitCube_XYZ_NOR(vpos: number): void;
  DrawUnitCube_XYZ(vpos: number): void;
  
  // Misc methods
  SetBlend(enabled: boolean): void;
  GetPixelData(data: Uint8Array, offset: number, xres: number, yres: number): void;
  GetPixelDataRenderTarget(obj: PiRenderTarget, data: Uint8Array, xres: number, yres: number): void;
}

export interface PiTexture {
  mObjectID: WebGLTexture;
  mXres: number;
  mYres: number;
  mFormat: number;
  mType: number;
  mFilter: number;
  mWrap: number;
  mVFlip: boolean;
}

export interface PiRenderTarget {
  mObjectID: WebGLFramebuffer;
  mTex0?: PiTexture;
  mXres?: number;
  mYres?: number;
}

export interface PiShader {
  mProgram: WebGLProgram | null;
  mResult: boolean;
  mInfo: string;
  mHeaderLines: number;
  mErrorType?: number;
}

export interface PiVertexArray {
  mObject: WebGLBuffer;
}

export interface PiIndexArray {
  mObject: WebGLBuffer;
}

export interface PiVertexAttribs {
  mChannels: number[];
  mStride: number;
}

export type PiRendererFactory = () => PiRenderer;
