// types/src/ProfileTypes.ts

// Structural equivalent of SerializedDockview from dockview-core.
// Defined locally to avoid coupling the shared types package to a UI library.
export type SerializedLayout = Record<string, unknown>;

export interface ProfileData {
  theme: 'light' | 'dark';
  layout: SerializedLayout | null;
  configPanel: {
    isVisible: boolean;
  };
  debugPanel: {
    isVisible: boolean;
    isVariableInspectorEnabled: boolean;
    isInlineRenderingEnabled: boolean;
    isPixelInspectorEnabled: boolean;
  };
  performancePanel: {
    isVisible: boolean;
  };
}

export interface ProfileIndex {
  active: string;
  order: Array<{ id: string; name: string }>;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'profile'
  );
}

export function defaultProfileData(): ProfileData {
  return {
    theme: 'dark',
    layout: null,
    configPanel: { isVisible: false },
    debugPanel: {
      isVisible: false,
      isVariableInspectorEnabled: false,
      isInlineRenderingEnabled: true,
      isPixelInspectorEnabled: true,
    },
    performancePanel: { isVisible: false },
  };
}
