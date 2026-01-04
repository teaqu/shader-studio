export interface ShaderFile {
    name: string;
    path: string;
    relativePath: string;
    configPath?: string;
    hasConfig: boolean;
    thumbnailData?: string;
    modifiedTime?: number;
    createdTime?: number;
}

export interface WorkspaceShaders {
    shaders: ShaderFile[];
    workspacePath: string;
}
