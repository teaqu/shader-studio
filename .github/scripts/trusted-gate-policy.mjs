// Loaded only from the protected base branch. PR files and comments are data.
export function isPolicyFile(file) {
  return /^(?:\.github\/|\.githooks\/)/.test(file)
    || /(?:^|\/)(?:scripts|e2e|test|tests|__tests__)\//.test(file)
    || /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|\.node-version|\.nvmrc|\.gitignore|\.eslintignore|\.prettierignore|CODEOWNERS|AGENTS\.md)$/.test(file)
    || /(?:^|\/)(?:eslint|vitest|playwright|vite|svelte)\.config\.[^/]+$/.test(file)
    || /(?:^|\/)(?:tsconfig[^/]*\.json|knip(?:\.[^/]+)?|turbo\.json)$/.test(file)
    || /\.(?:test|spec)\.[^/]+$/.test(file);
}

export function evaluatePolicy({ owner, headSha, files, reviews, comments }) {
  const changed = files.filter(file => isPolicyFile(file.filename) || (file.previous_filename && isPolicyFile(file.previous_filename)));
  if (!changed.length) {
    return { state: "success", description: "Gate policy matches the trusted base branch", changed: [] };
  }
  const decisions = reviews.filter(review => review.user?.login === owner && review.user?.type !== "Bot"
    && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
    .map(review => ({ time: review.submitted_at ?? "", allowed: review.state === "APPROVED" && review.commit_id === headSha }));
  for (const comment of comments) {
    if (comment.user?.login !== owner || comment.user?.type === "Bot" || (comment.updated_at && comment.updated_at !== comment.created_at)) {
      continue;
    }
    const match = /^\/(approve|revoke)-ci-policy ([a-f0-9]{40})$/.exec(comment.body.trim());
    if (match && match[2] === headSha) {
      decisions.push({ time: comment.updated_at ?? comment.created_at, allowed: match[1] === "approve" });
    }
  }
  decisions.sort((a, b) => a.time.localeCompare(b.time) || Number(b.allowed) - Number(a.allowed));
  const allowed = decisions.at(-1)?.allowed === true;
  return {
    state: allowed ? "success" : "failure",
    description: allowed ? "Owner approved gate-policy changes at this exact commit" : "Gate-policy changes require owner approval at this exact commit",
    changed: changed.map(file => file.filename),
  };
}

export async function checkPullRequest({ github, context, core, number }) {
  const repository = context.repo;
  const { data: pull } = await github.rest.pulls.get({ ...repository, pull_number: number });
  if (pull.state !== "open" || pull.base.ref !== "main") {
    return;
  }
  const status = { ...repository, sha: pull.head.sha, context: "CI policy integrity", target_url: `https://github.com/${repository.owner}/${repository.repo}/actions/runs/${context.runId}` };
  // Leave pending if any API/read/validation step fails; never reuse a stale pass.
  await github.rest.repos.createCommitStatus({ ...status, state: "pending", description: "Checking trusted gate policy" });
  const [files, reviews, comments] = await Promise.all([
    github.paginate(github.rest.pulls.listFiles, { ...repository, pull_number: number, per_page: 100 }),
    github.paginate(github.rest.pulls.listReviews, { ...repository, pull_number: number, per_page: 100 }),
    github.paginate(github.rest.issues.listComments, { ...repository, issue_number: number, per_page: 100 }),
  ]);
  if (files.length !== pull.changed_files) {
    throw new Error("Incomplete changed-file inventory; refusing to pass the policy gate");
  }
  const result = evaluatePolicy({ owner: repository.owner, headSha: pull.head.sha, files, reviews, comments });
  await core.summary.addHeading("Trusted CI policy").addRaw(`${result.description}\n\n`).addList(result.changed).write();
  await github.rest.repos.createCommitStatus({ ...status, state: result.state, description: result.description });
  if (result.state === "failure") {
    core.setFailed(`${result.description}. Owner command: /approve-ci-policy ${pull.head.sha}`);
  }
}
