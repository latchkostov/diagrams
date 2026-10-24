## PR #272 review fixes: keyboard behavior independent of download timing

The loading shell keeps keyboard input until the searchable rows are ready. The initial query
commits before replay; each subsequent edit and navigation key commits before the next, so Enter
selects the same item as a loaded menu. Input aimed at another control remains available there.
Immediate Enter without navigation and the existing Escape and Retry paths remain available.

Inputs retains the same shell, Close control and opener while both required chunks download in
parallel. No new controls, chrome or user-facing copy are added. The resumed image-export test
checks capacity marks in the actual file, rather than only its download name.
