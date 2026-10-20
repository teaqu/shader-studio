/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set for pull request previews, which keep their stored data separate. */
  readonly VITE_PREVIEW_CHANNEL?: string;
}
