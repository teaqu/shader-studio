// Decides whether a pull request preview may deploy. Anyone with triage access
// can add a label, so the `preview` label only counts when an approver added
// it: the repository owner, plus any logins in the PREVIEW_APPROVERS repository
// variable (separated by commas or spaces).

export const PREVIEW_LABEL = 'preview';

export function approvers(owner, configured = '') {
  return new Set([owner, ...String(configured ?? '').split(/[\s,]+/)]
    .filter(Boolean)
    .map((login) => login.replace(/^@/, '').toLowerCase()));
}

/** Who added the label most recently, from the issue events in time order. */
export function lastLabeller(events, label = PREVIEW_LABEL) {
  let login = null;
  for (const event of events ?? []) {
    if (event?.event === 'labeled' && event.label?.name === label) {
      login = event.actor?.login ?? null;
    }
  }
  return login;
}

export function previewApproval({ owner, configured, events, label = PREVIEW_LABEL }) {
  const labeller = lastLabeller(events, label);
  return { labeller, approved: labeller !== null && approvers(owner, configured).has(labeller.toLowerCase()) };
}
