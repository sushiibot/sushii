/**
 * Enforces Conventional Commit subjects and a linear history (no merge commits).
 *
 *   check-commits.ts message <file>   commit-msg hook
 *   check-commits.ts pre-push         pre-push hook, reads refs from stdin
 */

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "test",
  "docs",
  "style",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

const SCOPE = "[a-z0-9][a-z0-9._/-]*";
const SUBJECT = new RegExp(
  `^(${COMMIT_TYPES.join("|")})(\\(${SCOPE}(, ?${SCOPE})*\\))?!?: \\S`,
);
// Autosquash markers are fine in a local commit but must be squashed before pushing
const AUTOSQUASH = /^(fixup|squash|amend)! /;
const ZERO_SHA = /^0+$/;

export interface Commit {
  sha: string;
  subject: string;
  parentCount: number;
}

export function checkSubject(
  subject: string,
  { allowAutosquash = false } = {},
): string | null {
  if (allowAutosquash && AUTOSQUASH.test(subject)) {
    return null;
  }

  if (!SUBJECT.test(subject)) {
    return `not a Conventional Commit, expected "<type>(<scope>): <summary>" with type one of ${COMMIT_TYPES.join(", ")}`;
  }

  return null;
}

export function checkCommits(commits: Commit[]): string[] {
  const errors: string[] = [];

  for (const commit of commits) {
    const label = `${commit.sha.slice(0, 8)} "${commit.subject}"`;

    if (commit.parentCount > 1) {
      errors.push(
        `${label}: merge commit, rebase or squash onto the target instead`,
      );
      continue;
    }

    const error = checkSubject(commit.subject);
    if (error) {
      errors.push(`${label}: ${error}`);
    }
  }

  return errors;
}

/** Takes the subject from a commit message file the way git's default cleanup would. */
export function subjectFromMessage(message: string): string {
  return (
    message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("#")) ?? ""
  );
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }

  return result.stdout.toString();
}

function listCommits(revListArgs: string[]): Commit[] {
  return git(["log", "--format=%H%x00%P%x00%s%x1e", ...revListArgs])
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, subject] = record.split("\0");
      return {
        sha,
        subject,
        parentCount: parents.split(" ").filter(Boolean).length,
      };
    });
}

function commitExists(sha: string): boolean {
  return (
    Bun.spawnSync(["git", "cat-file", "-e", `${sha}^{commit}`]).exitCode === 0
  );
}

function pushedCommits(localSha: string, remoteSha: string): Commit[] {
  // New branches and force pushes over unknown commits: check what no remote has yet
  if (ZERO_SHA.test(remoteSha) || !commitExists(remoteSha)) {
    return listCommits([localSha, "--not", "--remotes"]);
  }

  return listCommits([`${remoteSha}..${localSha}`]);
}

function report(errors: string[]): never {
  if (errors.length === 0) {
    process.exit(0);
  }

  console.error("Commit check failed:");
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  console.error(
    "\nUse Conventional Commits and keep history linear (rebase or squash, no merge commits).",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);

  if (mode === "message") {
    const subject = subjectFromMessage(await Bun.file(args[0]).text());
    const error = checkSubject(subject, { allowAutosquash: true });
    report(error ? [`"${subject}": ${error}`] : []);
  }

  if (mode === "pre-push") {
    const commits: Commit[] = [];
    for (const line of (await Bun.stdin.text()).split("\n")) {
      const [, localSha, , remoteSha] = line.trim().split(" ");
      // Branch deletions have nothing to check
      if (!localSha || ZERO_SHA.test(localSha)) {
        continue;
      }
      commits.push(...pushedCommits(localSha, remoteSha));
    }
    report(checkCommits(commits));
  }

  console.error("Usage: check-commits.ts message <file> | pre-push");
  process.exit(2);
}

if (import.meta.main) {
  await main();
}
