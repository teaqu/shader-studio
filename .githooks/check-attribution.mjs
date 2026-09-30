#!/usr/bin/env node
/**
 * Rejects AI tool attribution in commit messages, branch names and pull
 * requests. AGENTS.md forbids it; this makes the rule enforceable.
 *
 *   --message-file <path>   check one commit message (commit-msg hook)
 *   --range <base>..<head>  check every commit message in a range (CI)
 *   --branch <name>         check a branch name
 *   --text <label>=<text>   check free text such as a PR title or body
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AGENTS = 'claude|anthropic|codex|openai|chatgpt|copilot|cursor|gemini|devin|aider|windsurf|codeium|jules';
const AGENT = new RegExp(`\\b(${AGENTS})\\b`, 'i');
// "cursor" is also an editor term (cursor-position-fix), so only trailers
// and footers treat it as a tool name.
const BRANCH = new RegExp(`^(${AGENTS.replace('|cursor', '')})[/_-]`, 'i');

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
    // The tool must be what the text was generated with, not merely named
    // on the same line, so prose describing these rules passes.
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

/** Returns one violation per offending line of a commit message or PR text. */
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

export function checkBranch(name) {
  return BRANCH.test(name.replace(/^refs\/heads\//, ''))
    ? [{ reason: 'agent name in branch name', line: name }]
    : [];
}

export function commitMessagesInRange(range, run = execFileSync) {
  const log = run('git', ['log', '--format=%H%x00%B%x01', range], { encoding: 'utf8' });
  return log.split('\x01')
    .map(entry => entry.replace(/^\n/, ''))
    .filter(Boolean)
    .map(entry => {
      const [sha, message] = entry.split('\x00');
      return { sha, message };
    });
}

export function run(argv, { readFile = readFileSync, commits = commitMessagesInRange } = {}) {
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
      for (const { sha, message } of commits(value)) {
        findings.push(...checkMessage(message).map(v => ({ ...v, where: `commit ${sha.slice(0, 8)}` })));
      }
    } else if (flag === '--branch') {
      findings.push(...checkBranch(value).map(v => ({ ...v, where: 'branch' })));
    } else if (flag === '--text') {
      const split = value.indexOf('=');
      const [label, text] = split < 0 ? ['text', value] : [value.slice(0, split), value.slice(split + 1)];
      findings.push(...checkMessage(text).map(v => ({ ...v, where: label })));
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
