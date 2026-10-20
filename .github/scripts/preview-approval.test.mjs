import assert from 'node:assert/strict';
import test from 'node:test';
import { approvers, lastLabeller, previewApproval } from './preview-approval.mjs';

const labeled = (login, name = 'preview') => ({ event: 'labeled', label: { name }, actor: { login } });

test('approvers are the owner plus the configured logins, case-insensitively', () => {
  assert.deepEqual([...approvers('Teaqu')], ['teaqu']);
  assert.deepEqual([...approvers('teaqu', ' @Alice, bob  carol,')], ['teaqu', 'alice', 'bob', 'carol']);
  assert.deepEqual([...approvers('teaqu', undefined)], ['teaqu']);
  assert.deepEqual([...approvers('teaqu', null)], ['teaqu']);
});

test('the most recent preview label decides, whatever else was labelled', () => {
  const events = [
    labeled('teaqu'),
    { event: 'unlabeled', label: { name: 'preview' }, actor: { login: 'teaqu' } },
    labeled('mallory'),
    labeled('teaqu', 'bug'),
  ];
  assert.equal(lastLabeller(events), 'mallory');
  assert.equal(lastLabeller([labeled('teaqu')]), 'teaqu');
  assert.equal(lastLabeller([]), null);
  assert.equal(lastLabeller(undefined), null);
  assert.equal(lastLabeller([{ event: 'labeled', label: { name: 'preview' } }]), null);
  assert.equal(lastLabeller([null, { event: 'commented' }]), null);
});

test('a preview deploys only when an approver added the label last', () => {
  assert.deepEqual(previewApproval({ owner: 'teaqu', events: [labeled('TeaQu')] }), { labeller: 'TeaQu', approved: true });
  assert.deepEqual(previewApproval({ owner: 'teaqu', events: [labeled('mallory')] }), { labeller: 'mallory', approved: false });
  assert.equal(previewApproval({ owner: 'teaqu', configured: 'alice', events: [labeled('alice')] }).approved, true);
  // An approver's label stops counting once someone else re-adds it.
  assert.equal(previewApproval({ owner: 'teaqu', events: [labeled('teaqu'), labeled('mallory')] }).approved, false);
  assert.deepEqual(previewApproval({ owner: 'teaqu', events: [] }), { labeller: null, approved: false });
});
