## Tooling review

Checked CLI continuation and failure recovery against predictable behavior and progressive
disclosure. PR identity preserves saved acceptance criteria; explicit replacement flags make the
intent change visible. Delta prompts identify their starting SHA and keep whole-PR context separate.
Unknown previous IDs produce a diagnostic without discarding the review round. No application
controls or layout changes are needed.
