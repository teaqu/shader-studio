export { glslLanguageDefinition } from './glsl-language';
export { shaderStudioTheme, shaderStudioTransparentTheme } from './glsl-theme';
export { slangLanguageDefinition } from './slang-language';
export { setupMonacoGlsl, setupMonacoSlang } from './setup';
export {
  MonacoLanguageServiceManager,
  setupMonacoLanguageServices,
  type LanguageServiceFactory,
  type MonacoLanguageServiceFactories,
} from './language-services/MonacoLanguageServiceManager';
