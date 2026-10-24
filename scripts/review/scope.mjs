import { execFileSync } from "node:child_process";

// Exclude confidential local inputs before Git emits either paths or contents.
const paths = [".", ":(exclude)src/examples/private/**"];
export function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
const sha = (root, ref) => git(root, "rev-parse", "--verify", `${ref}^{commit}`).trim();
const names = (root, from, to) =>
  git(root, "diff", "--no-renames", "--name-only", "-z", from, to, "--", ...paths)
    .split("\0")
    .filter(Boolean);

/** Relocate previously changed lines across a patch, then mark its new hunks when in scope. */
export function changedLines(patch, previous = [], include = true) {
  const hunks = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({
    old: Number(m[1]),
    oldCount: Number(m[2] ?? 1),
    next: Number(m[3]),
    count: Number(m[4] ?? 1),
  }));
  const result = new Set();
  for (const line of previous) {
    let shift = 0;
    let removed = false;
    for (const h of hunks) {
      if (h.oldCount && line >= h.old && line < h.old + h.oldCount) {
        removed = true;
        break;
      }
      if (h.oldCount ? line >= h.old + h.oldCount : line > h.old) shift += h.count - h.oldCount;
    }
    if (!removed) result.add(line + shift);
  }
  if (include)
    for (const h of hunks)
      for (let line = Math.max(1, h.next); line < Math.max(1, h.next) + Math.max(1, h.count); line++) result.add(line);
  return [...result].sort((a, b) => a - b);
}

export function reviewScope(root, { since, full = false } = {}) {
  const head = sha(root, "HEAD");
  const base = git(root, "merge-base", "origin/master", head).trim();
  if (full)
    return {
      head,
      base,
      mode: "full",
      files: git(root, "ls-files", "-z", "--", ...paths)
        .split("\0")
        .filter(Boolean),
      lines: {},
      patch: "",
    };
  if (!since) {
    const range = `${base}...${head}`;
    const files = names(root, base, head);
    const lines = Object.fromEntries(
      files.map((file) => [
        file,
        changedLines(git(root, "diff", "--no-ext-diff", "--no-renames", "--unified=0", range, "--", file)),
      ]),
    );
    return {
      head,
      base,
      mode: "branch",
      range,
      files,
      lines,
      patch: git(root, "diff", "--no-ext-diff", "--no-renames", range, "--", ...paths),
    };
  }
  since = sha(root, since);
  const chain = git(root, "rev-list", "--first-parent", head).trim().split("\n");
  if (!chain.includes(since))
    throw new Error(
      "--since must be on HEAD's first-parent history; after a rebase, supply a reviewed ancestor explicitly",
    );
  // A first-parent log excludes master's commits even when master was merged after the reviewed SHA.
  const commits = git(root, "rev-list", "--first-parent", "--reverse", `${since}..${head}`)
    .trim()
    .split("\n")
    .filter(Boolean);
  const featureCommits = git(root, "rev-list", "--first-parent", "--no-merges", `${base}..${head}`)
    .trim()
    .split("\n")
    .filter(Boolean);
  const touched = new Set(featureCommits.flatMap((commit) => names(root, `${commit}^`, commit)));
  const lines = {};
  const patches = [];
  const files = new Set();
  for (const commit of commits) {
    const parents = git(root, "rev-list", "--parents", "-n", "1", commit).trim().split(" ").slice(1);
    for (const file of names(root, parents[0], commit)) {
      const include = parents.length === 1 || touched.has(file);
      if (!include && !lines[file]) continue;
      const patch = git(root, "diff", "--no-ext-diff", "--no-renames", "--unified=0", parents[0], commit, "--", file);
      lines[file] = changedLines(patch, lines[file], include);
      if (include) {
        files.add(file);
        patches.push(`# Commit ${commit} against first parent ${parents[0]}\n${patch}`);
      }
    }
  }
  return { head, base, since, mode: "delta", commits, files: [...files].sort(), lines, patch: patches.join("\n") };
}
