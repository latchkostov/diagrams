## Review CLI scope and continuity

Reviewed the command and report flow against progressive disclosure and clear recovery. The default
remains a PR review followed by small fix rounds. Repository-wide scope requires `--audit`, while
`--full` consistently means the entire PR. Detached checkout errors point to `--pr` or `--branch`.
Reports put round, file count and a copyable next-round command before the file list, including the
owner-approval flag at the round cap. No application controls or canvas behavior change.

Reset is explicit and takes effect only after a successful review. Standalone runs preserve saved
rounds, and competing completions fail clearly instead of silently overwriting evidence. Kept fuzzy
matching for findings without an identity; rejected fuzzy overrides of explicit IDs because they can
collapse separate outstanding issues.
