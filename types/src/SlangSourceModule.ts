export interface SlangSourceModule {
  moduleName: string;
  path: string;
  source: string;
  ownerPass: string;
}

export interface SlangDependencyDiagnostic {
  code: 'slang-module-not-found';
  importerPath: string;
  moduleName: string;
  resolvedPath: string;
  message: string;
}
