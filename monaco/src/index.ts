export { glslLanguageDefinition } from './glsl-language';
export { shaderStudioTheme, shaderStudioTransparentTheme } from './glsl-theme';
export { setupMonacoGlsl } from './setup';
export {
  acquireEditorModel,
  acquireEditorModelReference,
  canonicalEditorUri,
  createEditorModelOwner,
  getEditorModelOwnerReferenceCount,
  releaseEditorModel,
  type EditorModelOwner,
  type EditorModelOwnerKind,
  type EditorModelOwnerQuery,
  type EditorModelReference,
} from './modelRegistry';
export { slangLanguageDefinition } from './slang-language';
export {
  SlangMonacoAdapter,
  canonicalModelUri,
  SLANG_COMPILE_MARKER_OWNER,
  SLANG_LANGUAGE_MARKER_OWNER,
  type SlangMonacoClient,
} from './slang/SlangMonacoAdapter';
export { setupMonacoSlang } from './setup';
