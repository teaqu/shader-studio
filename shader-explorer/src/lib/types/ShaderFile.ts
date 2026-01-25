export interface ShaderFile {
    name: string;
    path: string;
    relativePath: string;
    configPath?: string;
    hasConfig: boolean;
    thumbnailData?: string;
    cachedThumbnail?: string; // Cached thumbnail from disk
    modifiedTime?: number;
    createdTime?: number;
}

export interface WorkspaceShaders {
    shaders: ShaderFile[];
    workspacePath: string;
}
