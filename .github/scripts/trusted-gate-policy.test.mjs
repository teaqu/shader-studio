import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, isPolicyFile } from "./trusted-gate-policy.mjs";
const sha = "a".repeat(40);
const input = (changes = ["ui/src/view.svelte"]) => ({ owner: "teaqu", headSha: sha, files: changes.map(filename => ({ filename })), reviews: [], comments: [] });
const approval = (body, login = "teaqu") => ({ user: { login }, body, created_at: "2026-01-01T00:00:00Z" });

test("ordinary source changes pass without an exception", () => {
  assert.equal(evaluatePolicy(input()).state, "success");
});
test("all gate definitions, toolchains, test harnesses and suppression policy are protected", () => {
  for (const file of [".github/workflows/new.yml", ".github/scripts/check.mjs", ".github/CODEOWNERS", ".githooks/check.mjs", "package.json", "ui/package.json", "package-lock.json", ".npmrc", "eslint.config.mjs", "rendering/eslint.config.mjs", "vitest.config.ts", "ui/vitest.config.ts", "rendering/tsconfig.test.json", "knip.jsonc", "turbo.json", "ui/scripts/compiler.mjs", "standalone/e2e/playwright.config.mjs", "extension/e2e/pw/runner.mjs", "ui/src/test/new.test.ts", ".gitignore", "ui/svelte.config.js"]) {
    assert.ok(isPolicyFile(file), file);
    assert.equal(evaluatePolicy(input([file])).state, "failure", file);
  }
});
test("renaming or deleting policy files cannot bypass classification", () => {
  const candidate = input([]);
  candidate.files = [{ filename: "innocent.txt", previous_filename: "vitest.config.ts", status: "renamed" }];
  assert.equal(evaluatePolicy(candidate).state, "failure");
  assert.equal(evaluatePolicy(input([".github/workflows/deleted.yml"])).state, "failure");
});
test("only a current owner review may authorize changed policy", () => {
  const candidate = input(["vitest.config.ts"]);
  for (const review of [
    { user: { login: "contributor" }, state: "APPROVED", commit_id: sha },
    { user: { login: "teaqu" }, state: "APPROVED", commit_id: "b".repeat(40) },
    { user: { login: "teaqu" }, state: "DISMISSED", commit_id: sha },
  ]) {
    assert.equal(evaluatePolicy({ ...candidate, reviews: [review] }).state, "failure");
  }
  const approved = { user: { login: "teaqu" }, state: "APPROVED", commit_id: sha, submitted_at: "2026-01-01" };
  assert.equal(evaluatePolicy({ ...candidate, reviews: [approved] }).state, "success");
  const rejected = { ...approved, state: "CHANGES_REQUESTED", submitted_at: "2026-01-02" };
  assert.equal(evaluatePolicy({ ...candidate, reviews: [rejected, approved] }).state, "failure");
});
test("owner-authored PRs need an explicit SHA-bound owner comment, never a PR body or other user's comment", () => {
  const candidate = input(["vitest.config.ts"]);
  const command = `/approve-ci-policy ${sha}`;
  assert.equal(evaluatePolicy({ ...candidate, comments: [approval(command)] }).state, "success");
  for (const comment of [approval(command, "attacker"), approval(`/approve-ci-policy ${"b".repeat(40)}`), approval(`quoted ${command}`), approval(`${command}\nextra`), { ...approval(command), user: { login: "teaqu", type: "Bot" } }]) {
    assert.equal(evaluatePolicy({ ...candidate, comments: [comment] }).state, "failure");
  }
});
test("an owner can revoke an explicit policy exception and newest decision wins", () => {
  const candidate = input(["vitest.config.ts"]);
  const allow = approval(`/approve-ci-policy ${sha}`);
  const revoke = { ...approval(`/revoke-ci-policy ${sha}`), created_at: "2026-01-02T00:00:00Z" };
  assert.equal(evaluatePolicy({ ...candidate, comments: [revoke, allow] }).state, "failure");
});

import { checkPullRequest } from "./trusted-gate-policy.mjs";
function harness(overrides = {}) {
  const pull = { state: "open", base: { ref: "main" }, head: { sha }, changed_files: 1, ...overrides };
  const statuses = [];
  const failures = [];
  const files = [{ filename: "vitest.config.ts" }];
  const summary = { addHeading() {
 return this;
}, addRaw() {
 return this;
}, addList() {
 return this;
}, async write() {} };
  const github = {
    rest: { pulls: { get: async () => ({ data: pull }), listFiles: "files", listReviews: "reviews" }, issues: { listComments: "comments" }, repos: { createCommitStatus: async status => statuses.push(status) } },
    paginate: async endpoint => endpoint === "files" ? files : [],
  };
  const options = { github, core: { summary, setFailed: message => failures.push(message) }, context: { repo: { owner: "teaqu", repo: "shader-studio" }, runId: 12 }, number: 111 };
  return { options, statuses, failures, files };
}
test("API guard publishes only to the exact live PR head and reports unapproved policy failure", async () => {
  const { options, statuses, failures } = harness();
  await checkPullRequest(options);
  assert.deepEqual(statuses.map(status => status.state), ["pending", "failure"]);
  assert.ok(statuses.every(status => status.sha === sha && status.context === "CI policy integrity"));
  assert.equal(failures.length, 1);
});
test("API guard publishes a pass for unchanged policy or a valid owner decision", async () => {
  const unchanged = harness();
  unchanged.files[0].filename = "ui/src/view.svelte";
  await checkPullRequest(unchanged.options);
  assert.equal(unchanged.statuses.at(-1).state, "success");
  const approved = harness();
  approved.options.github.paginate = async endpoint => endpoint === "files" ? approved.files : endpoint === "comments" ? [approval(`/approve-ci-policy ${sha}`)] : [];
  await checkPullRequest(approved.options);
  assert.equal(approved.statuses.at(-1).state, "success");
});
test("incomplete file inventory and API failures leave the commit pending rather than passing", async () => {
  const incomplete = harness({ changed_files: 3001 });
  await assert.rejects(checkPullRequest(incomplete.options), /Incomplete/);
  assert.deepEqual(incomplete.statuses.map(status => status.state), ["pending"]);
  const unavailable = harness();
  unavailable.options.github.paginate = async () => {
 throw new Error("API unavailable");
};
  await assert.rejects(checkPullRequest(unavailable.options), /API unavailable/);
  assert.deepEqual(unavailable.statuses.map(status => status.state), ["pending"]);
});
test("closed PRs and unrelated targets are never evaluated", async () => {
  for (const override of [{ state: "closed" }, { base: { ref: "feature" } }]) {
    const candidate = harness(override);
    await checkPullRequest(candidate.options);
    assert.deepEqual(candidate.statuses, []);
  }
});
test("trusted workflow reads main only, uses no PR execution or artifacts, and constrains manual dispatch to main", async () => {
  const { readFileSync } = await import("node:fs");
  const workflow = readFileSync(new URL("../workflows/trusted-gate-policy.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /npm (?:ci|install|run)|download-artifact|secrets: inherit|self-hosted|head\.sha|head\.ref/);
});

test("edited owner comments cannot authorize a policy change", () => {
  const candidate = input(["vitest.config.ts"]);
  const edited = { ...approval(`/approve-ci-policy ${sha}`), updated_at: "2026-01-02T00:00:00Z" };
  assert.equal(evaluatePolicy({ ...candidate, comments: [edited] }).state, "failure");
});
test("trusted status uses a separate app identity whose key is confined to a main-only environment", async () => {
  const { readFileSync } = await import("node:fs");
  const workflow = readFileSync(new URL("../workflows/trusted-gate-policy.yml", import.meta.url), "utf8");
  assert.match(workflow, /environment: trusted-gates/);
  assert.match(workflow, /create-github-app-token@[a-f0-9]{40}/);
  assert.match(workflow, /github-token: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
  assert.match(workflow, /permission-statuses: write/);
  assert.doesNotMatch(workflow, /^  statuses: write$/m);
});
test("conflicting owner decisions at the same timestamp fail closed", () => {
  const candidate = input(["vitest.config.ts"]);
  const allow = approval(`/approve-ci-policy ${sha}`);
  const revoke = approval(`/revoke-ci-policy ${sha}`);
  for (const comments of [[allow, revoke], [revoke, allow]]) {
    assert.equal(evaluatePolicy({ ...candidate, comments }).state, "failure");
  }
});
