## Claude plugin directory packaging

Live Diagrams now has a directory-ready plugin manifest, README, MIT licence and listing icon in
`skills/livediagrams`, with the existing skill discovered directly at that root. The repository
marketplace commands continue to work. The directory listing is coming soon, subject to approval;
the owner submission pack is in `docs/claude-directory/submission.md`.

The downloadable skill keeps exactly its existing payload and size budget; plugin listing files
are excluded. Plugin releases now carry an explicit manifest version, starting at `1.0.0`, with
manual semantic version bumps documented in the plugin README. Generators do not bump it.

The install page gains one translated coming-soon line. The intended parity change is
`node/i18n/catalogs.json`: only the pseudo-locale's `staticSkill` area hash changes because
`staticSkill.claudeCommands` now includes that sentence. Translations retain their existing instructions
pending translation. No diagram, simulation, layout, export or skill payload golden changes are intended.
