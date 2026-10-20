# Pull Request Previews

A pull request can be deployed to its own link before it merges, so the web
app and docs can be tried on a phone or shared for review:

```
https://teaqu.github.io/shader-studio/pr-preview/pr-<number>/app/
https://teaqu.github.io/shader-studio/pr-preview/pr-<number>/docs/
```

Previews are opt-in. Add the **`preview`** label to the pull request to deploy
it; the **PR Preview** workflow comments the link. Every push to the pull
request redeploys it while the label is on. Removing the label or closing the
pull request takes the preview down.

Only an approver can switch a preview on. The label counts only when the
repository owner, or a login listed in the **`PREVIEW_APPROVERS`** repository
variable (**Settings → Secrets and variables → Actions → Variables**, separated
by commas or spaces), was the last to add it. This is checked again on every
push, so a later push cannot deploy a label someone else added. When anyone
else adds the label, the run skips the deploy and says who added it.

Only pull requests from branches in this repository get previews. Pull requests
from forks are never built with a token that can write to the site. People who
can push branches here can already change workflows, so the approver check
guards against labels added by collaborators who can only triage.

## How It Is Served

The site is served by GitHub Pages from the `gh-pages` branch. The
**Deploy Pages** workflow publishes `main` to the branch root, and each preview
lives under `pr-preview/pr-<number>/`. Both use
`.github/scripts/publish-pages.mjs`, which only replaces its own directory and
retries when another deploy pushed first.

The repository's **Settings → Pages → Build and deployment → Source** must be
**Deploy from a branch**, with branch `gh-pages` and folder `/ (root)`.

## Storage Isolation

Previews share the live site's origin, so they would otherwise see and change a
visitor's real workspace. A build with `VITE_PREVIEW_CHANNEL` set (the workflow
uses `pr-<number>`) keeps everything apart:

- `localStorage` and `sessionStorage` keys are prefixed with
  `shader-studio-preview:<channel>:`.
- The workspace database and edit journal use channel-specific names. If the
  storage prefix cannot be installed, the preview keeps its workspace in memory
  only.
- The service worker uses a channel-specific cache and only controls the
  preview's own path.

Settings changed in one tab of a preview are not synced to its other open tabs.

To try an isolated build locally:

```sh
VITE_PREVIEW_CHANNEL=pr-local npm run build:standalone
npm run preview -w @shader-studio/standalone
```
