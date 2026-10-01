#!/usr/bin/env node
/**
 * Rejects AI tool attribution in commit messages, commit identities and branch
 * names. AGENTS.md forbids it; this makes the rule enforceable.
 *
 *   --message-file <path>   check one commit message (commit-msg hook)
 *   --identity <ident>      check one author or committer, "Name <email>" (commit-msg hook)
 *   --range <base>..<head>  check every commit message, author and committer in a range (CI)
 *   --branch <name>         check a branch name
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AGENTS = 'claude|anthropic|codex|openai|chatgpt|copilot|cursor|gemini|devin|aider|windsurf|codeium|jules';
const AGENT = new RegExp(`\\b(${AGENTS})\\b`, 'i');
// "cursor" is also an editor term (cursor-position-fix), so only trailers
// and footers treat it as a tool name.
const BRANCH = new RegExp(`^(${AGENTS.replace('|cursor', '')})[/_-]`, 'i');

// "Jules" and "Cursor" are also people's names, so an identity needs a tool's
// email domain or a [bot] suffix before those count.
const IDENTITY_NAME = new RegExp(`\\b(${AGENTS.replace('|cursor', '').replace('|jules', '')})\\b`, 'i');
const IDENTITY_BOT = new RegExp(`\\b(${AGENTS})\\b.*\\[bot\\]`, 'i');
const IDENTITY_DOMAIN = /@(anthropic|openai|cursor)\.com$/i;

/** Branch names a merge subject mentions: quoted sources and the unquoted target. */
function mergedBranches(subject) {
  return [...subject.matchAll(/['"]([^'"]+)['"]|\binto\s+(\S+)/g)]
    .map(([, quoted, target]) => (quoted ?? target).replace(/^(origin|upstream)\//, ''));
}

const MESSAGE_RULES = [
  {
    pattern: /^\s*co-authored-by:.*$/gim,
    applies: line => AGENT.test(line) || /noreply@(anthropic|openai)\.com/i.test(line),
    reason: 'AI co-author trailer',
  },
  {
    // The tool must be what the commit was generated with, not merely named
    // on the same line, so a message describing these rules passes.
    pattern: new RegExp(`^.*(?<![a-z])generated (with|by)\\s+[[(_*]*(${AGENTS})\\b.*$`, 'gim'),
    applies: () => true,
    reason: 'AI generation footer',
  },
  {
    pattern: /^[\s_*>-]*🤖.*$/gm,
    applies: () => true,
    reason: 'AI generation marker',
  },
  {
    // Merge subjects carry branch names, e.g. "Merge branch 'codex/x'".
    pattern: /^merge .*$/gim,
    applies: line => mergedBranches(line).some(name => BRANCH.test(name)),
    reason: 'agent-named branch in merge subject',
  },
];

/** Returns one violation per offending line of a commit message. */
export function checkMessage(text) {
  const violations = [];
  for (const { pattern, applies, reason } of MESSAGE_RULES) {
    for (const [line] of text.matchAll(pattern)) {
      if (applies(line)) {
        violations.push({ reason, line: line.trim() });
      }
    }
  }
  return violations;
}

/** Checks an author or committer, "Name <email>", with or without git var's trailing timestamp. */
export function checkIdentity(ident) {
  const match = ident.match(/^(.*?)\s*<([^>]*)>/);
  const [name, email] = match ? [match[1], match[2]] : [ident, ''];
  const offending = IDENTITY_NAME.test(name)
    || IDENTITY_BOT.test(name)
    || IDENTITY_BOT.test(email)
    || IDENTITY_DOMAIN.test(email);
  return offending ? [{ reason: 'AI tool commit identity', line: match ? match[0] : ident }] : [];
}

export function checkBranch(name) {
  return BRANCH.test(name.replace(/^refs\/heads\//, ''))
    ? [{ reason: 'agent name in branch name', line: name }]
    : [];
}

export function commitsInRange(range, run = execFileSync) {
  const log = run('git', ['log', '--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01', range], { encoding: 'utf8' });
  return log.split('\x01')
    .map(entry => entry.replace(/^\n/, ''))
    .filter(Boolean)
    .map(entry => {
      const [sha, author, committer, message] = entry.split('\x00');
      return { sha, author, committer, message };
    });
}

export function run(argv, { readFile = readFileSync, commits = commitsInRange } = {}) {
  const findings = [];
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === '--message-file') {
      // Git passes the message with its comment lines still present.
      const message = readFile(value, 'utf8').replace(/^#.*$/gm, '');
      findings.push(...checkMessage(message).map(v => ({ ...v, where: 'commit message' })));
    } else if (flag === '--range') {
      for (const { sha, message, author, committer } of commits(value)) {
        const where = `commit ${sha.slice(0, 8)}`;
        findings.push(...checkMessage(message).map(v => ({ ...v, where })));
        findings.push(...checkIdentity(author).map(v => ({ ...v, where: `${where} author` })));
        findings.push(...checkIdentity(committer).map(v => ({ ...v, where: `${where} committer` })));
      }
    } else if (flag === '--identity') {
      findings.push(...checkIdentity(value).map(v => ({ ...v, where: 'commit identity' })));
    } else if (flag === '--branch') {
      findings.push(...checkBranch(value).map(v => ({ ...v, where: 'branch' })));
    } else {
      throw new Error(`unknown option ${flag}`);
    }
  }
  return findings;
}

function main() {
  let findings;
  try {
    findings = run(process.argv.slice(2));
  } catch (error) {
    console.error(`check-attribution: ${error.message}`);
    process.exit(2);
  }
  if (findings.length === 0) {
    return;
  }
  console.error('AI tool attribution is not allowed in this repository (see AGENTS.md):');
  for (const { where, reason, line } of findings) {
    console.error(`  ${where}: ${reason}: ${line}`);
  }
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
