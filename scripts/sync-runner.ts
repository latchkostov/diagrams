import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { format } from "prettier";
import generated from "./generated-files.json";
import { classifyConflict, mergeEnglish, withoutGeneratedRegions } from "./sync-lib";

type Result = { status: number | null; stdout: string; stderr: string };
export type Run = (command: string, args: string[]) => Result;

export function sync(root: string, run: Run, log: (text: string) => void, continuing = false): Promise<void> {
  const git = (...args: string[]) => run("git", args);
  const checked = (result: Result) => {
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Command failed");
    return result.stdout;
  };
  const active = () =>
    ["rebase-merge", "rebase-apply"].some((name) =>
      existsSync(path.resolve(root, checked(git("rev-parse", "--git-path", name)).trim())),
    );
  const conflicts = () =>
    checked(git("diff", "--name-only", "--diff-filter=U", "-z"))
      .split("\0")
      .filter(Boolean);
  const regenerate = () => {
    checked(run("pnpm", ["regen"]));
    // Explicit allowlist; never stage another source file, a user's edit or parity output.
    for (const file of [...generated.files, ...generated.regions])
      if (existsSync(path.join(root, file))) checked(git("add", "--", file));
  };
  return (async () => {
    if (continuing !== active())
      throw new Error(
        continuing
          ? "No rebase to continue."
          : "Rebase in progress. Resolve conflicts, then pnpm sync --continue (or git rebase --abort).",
      );
    if (!continuing) {
      if (checked(git("status", "--porcelain", "--untracked-files=normal")).trim())
        throw new Error("Commit or stash your changes before pnpm sync.");
      if (!checked(git("branch", "--show-current")).trim()) throw new Error("Check out a branch before pnpm sync.");
      checked(git("fetch", "origin"));
    }
    let result = continuing ? { status: 1, stdout: "", stderr: "" } : git("rebase", "--gpg-sign", "origin/master");
    while (result.status !== 0) {
      if (!active()) checked(result);
      for (const file of conflicts()) {
        const kind = classifyConflict(file);
        if (kind === "manual" || kind === "golden") continue;
        if (kind === "generated") {
          const ours = git("show", `:2:${file}`);
          if (ours.status === 0) {
            writeFileSync(path.join(root, file), ours.stdout);
            checked(git("add", "--", file));
          } else checked(git("rm", "--", file));
          log(`regenerate: ${file}`);
          continue;
        }
        try {
          const versions = [1, 2, 3].map((stage) => checked(git("show", `:${stage}:${file}`)));
          let merged: string;
          if (kind === "english")
            merged = await format(mergeEnglish(versions[0], versions[1], versions[2]), {
              parser: "typescript",
              printWidth: 110,
            });
          else {
            const temp = mkdtempSync(path.join(tmpdir(), "diagrams-sync-"));
            try {
              const files = versions.map((text, i) => {
                const name = path.join(temp, `${i}.md`);
                writeFileSync(name, withoutGeneratedRegions(text));
                return name;
              });
              // Rebase stage 2 is the new upstream; stage 3 is the commit being replayed.
              merged = checked(git("merge-file", "-p", files[1], files[0], files[2]));
            } finally {
              rmSync(temp, { recursive: true, force: true });
            }
          }
          writeFileSync(path.join(root, file), merged);
          checked(git("add", "--", file));
          log(`merged: ${file}`);
        } catch (error) {
          log(`${file}: ${String(error)}`);
        }
      }
      const remaining = conflicts();
      if (remaining.length)
        throw new Error(
          `Resolve these conflicts, git add each resolved file, then pnpm sync --continue:\n${remaining.map((f) => `  ${f}`).join("\n")}\nParity goldens are never resolved by sync. Run pnpm parity:update and review any intended output changes. Abort with git rebase --abort.`,
        );
      regenerate();
      const hasChanges = checked(git("diff", "--cached", "--name-only")).trim();
      result = git("-c", "core.editor=true", "rebase", hasChanges ? "--continue" : "--skip");
      // A signing/exec/locking failure is not a merge conflict. Never retry it in a loop.
      if (result.status !== 0 && !conflicts().length) checked(result);
    }
    regenerate();
    const staged = checked(git("diff", "--cached", "--name-only")).trim();
    if (staged) checked(git("commit", "-S", "--amend", "--no-edit"));
    log(
      "Synced with origin/master; generated artifacts refreshed. Run pnpm i18n check, pnpm skill:check, pnpm test and pnpm parity. Review output changes; sync never updates parity goldens.",
    );
  })();
}

export function gitRunner(root: string): Run {
  return (command, args) => {
    // pnpm.cmd needs cmd.exe on Windows; arguments here are fixed, never user-supplied shell text.
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: "utf8",
      shell: command === "pnpm" && process.platform === "win32",
      maxBuffer: 32 * 1024 * 1024,
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.error?.message ?? result.stderr ?? "" };
  };
}
