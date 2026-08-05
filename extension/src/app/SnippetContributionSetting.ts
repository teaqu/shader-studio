import {
  SNIPPET_CONTRIBUTIONS,
  type SnippetContribution,
} from './SnippetContributions';

export interface SnippetContributionManifest {
  contributes: {
    snippets?: SnippetContribution[];
    [key: string]: unknown;
  };
}

export function applySnippetContributionSetting(
  manifest: SnippetContributionManifest,
  enabled: boolean,
): void {
  if (enabled) {
    manifest.contributes.snippets = SNIPPET_CONTRIBUTIONS.map(
      (contribution) => ({ ...contribution }),
    );
  } else {
    delete manifest.contributes.snippets;
  }
}
