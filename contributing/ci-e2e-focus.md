# Focused E2E Runs in CI

Some E2E failures only reproduce on the CI runners: WebGPU specs need the
macOS GPU runner, the VS Code suites run the packaged VSIX, and timing differs
from a development machine. Rerunning the full **Test** workflow for each
attempt takes most of an hour, and a new push cancels the jobs still running.

The **E2E focus** workflow reruns only the specs you name, on the same runners
and with the same setup as **Verify**. Use it to confirm a fix or reproduce a
CI-only failure, then let the pull request's full **Test** run gate the merge.

## Dispatch a run

From the Actions tab, open **E2E focus**, choose **Run workflow**, pick the
branch and fill in the inputs. From a terminal:

```bash
# Two standalone specs, filtered by title
gh workflow run e2e-focus.yml --ref my-branch \
  -f suite=standalone -f specs="web.e2e.mjs files.e2e.mjs" -f grep="Open Files|tab order"

# One VS Code spec on the GPU runner, repeated to check for flakiness
gh workflow run e2e-focus.yml --ref my-branch \
  -f suite=vscode-gpu -f specs=wgsl-debug-parity -f repeat=5

# Follow the run
gh run watch "$(gh run list --workflow e2e-focus.yml --branch my-branch --limit 1 --json databaseId --jq '.[0].databaseId')"
```

| Input | Meaning |
| --- | --- |
| `suite` | `standalone` (macOS Chromium with WebGPU), `vscode` (installed VSIX on Linux, `@gpu` specs skipped), `vscode-gpu` (installed VSIX on the macOS GPU runner, every selected spec), `vscode-corpus` (extension-host shader corpus), `rendering` (rendering browser Vitest), `rendering-corpus` (shader fixture corpus) or `ui` (UI transport browser tests). |
| `specs` | Spec files or path filters separated by spaces or commas. Blank runs the whole suite. |
| `grep` | Test title regular expression: Playwright `--grep`, or Vitest `--testNamePattern` for the Vitest suites. |
| `repeat` | Runs each selected Playwright test up to 20 times. Not available for the Vitest suites (`rendering`, `rendering-corpus`, `ui`). |
| `project` | Standalone Playwright project, such as `chromium`, `mobile-chromium` or `firefox-exports`. |

Failed Playwright runs upload their traces as the `e2e-focus-*` artifact.

## Notes

- GitHub only offers **Run workflow** for workflows that exist on the default
  branch, so a change to this workflow takes effect after it merges. Any branch
  can then be selected with `--ref`.
- Inputs are validated by `.github/scripts/e2e-focus.mjs` and passed to the test
  runner as arguments. Spec filters are limited to plain paths.
- A focused run does not replace the full workflow: other specs can still be
  affected by the same change.

## Full verification and labels

Adding or removing a PR label, including `preview` or `ci:full`, does not start
or cancel **Test**. The `ci:full` label selects all E2E suites on the next PR
update. For a full run immediately, choose **Test → Run workflow** and select
the PR branch, or run:

```bash
gh workflow run test.yml --ref my-branch
```

A manual Test run always selects every suite. Preview labels independently
control the **PR Preview** workflow.
