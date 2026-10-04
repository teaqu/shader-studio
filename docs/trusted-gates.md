# Trusted gate policy

The `Trusted gate policy` workflow runs from `main` and treats PR files,
reviews and comments as API data. It never checks out PR code, runs PR commands,
installs dependencies, restores caches, or downloads PR artifacts. Existing
verification jobs continue to test the candidate code with their normal
read-only permissions.

The guard covers every current gate: workflows, gate scripts, package manifests
and lockfiles, lint/type/build/test/coverage configurations, ignore rules,
attribution hooks, unit tests and browser/extension test harnesses. Changes to
these files require a current approval from the repository owner. Otherwise the
`CI policy integrity` status fails, even if a PR weakens its ordinary checks.
Renames check both names; incomplete API inventories and errors fail closed.

## Separate publisher identity

**Do not require this status under the GitHub Actions identity.** A same-repository
PR workflow can request `statuses: write` and forge an Actions-owned context.
The trusted guard publishes through a dedicated GitHub App, and branch protection
must bind this required context to that App's numeric ID.

The App needs repository permissions **Commit statuses: write** and **Pull
requests: read**, plus GitHub's mandatory metadata read permission. Install it
only on `teaqu/shader-studio`. Webhooks and user authorization are unnecessary.
It needs no contents write, administration, issue write or checks write access.

Store its private key as `TRUSTED_GATE_APP_PRIVATE_KEY` in the `trusted-gates`
**environment**, never as a repository/organization-wide secret. Set the
repository variable `TRUSTED_GATE_APP_ID` to the App ID.

Configure that environment with custom deployment branch policies: one **branch**
rule named exactly `main`, no tag rule, no wildcard. PR merge refs and other
branches must be rejected. This prevents a PR-authored workflow from obtaining
the App key and impersonating the trusted guard. Keep environment administration
limited to trusted administrators. The workflow also rejects manual dispatch
from any branch other than `main`.

## Activation

1. Merge the small bootstrap PR containing this workflow and its dependency-free
   script/tests into `main`. A new `pull_request_target` workflow cannot enforce
   its own unmerged bootstrap.
2. Create/install the dedicated App and configure the environment/variable above.
3. Dispatch `Trusted gate policy` **on main** against an open PR; verify that the
   commit status is published by the dedicated App. Confirm an unapproved
   policy/config change fails and a source-only change passes.
4. Add required check `CI policy integrity` with the dedicated App ID to main's
   required status checks, preserving all existing required checks and strict
   up-to-date checking. Do not bind it to the GitHub Actions App.
5. Confirm a same-named status from GitHub Actions does not satisfy the App-bound
   requirement. Keep the existing owner review and last-push approval rules.

GitHub's existing administrator bypass remains separate from these checks;
trusted administrators can still explicitly override branch protection.

## Approving deliberate policy changes

A repository-owner `APPROVED` review must name the exact current PR head commit.
After a native review, manually dispatch the guard on `main` to re-evaluate;
review events do not automatically run this trusted workflow.

GitHub does not allow reviewing your own PR. For owner-authored PRs, the owner may
post this exact standalone comment, using the full current 40-character SHA:

```
/approve-ci-policy FULL_HEAD_SHA
```

It applies only to that revision; a new push needs a new decision. The owner can
post `/revoke-ci-policy FULL_HEAD_SHA` to revoke it. Edited comments, quoted
commands, bot comments and other users' comments cannot authorize an exception.
Conflicting decisions at the same timestamp fail closed. Comment events
re-evaluate the live PR head, so an outdated event cannot authorize a newer SHA.

Approval should follow review of all policy and test changes. An agent must not
post an approval on the owner's behalf without the user's explicit authorization
for that revision. Passing tests and coverage remain evidence about reviewed
executable code, not a proof that arbitrary malicious code cannot game tests.
