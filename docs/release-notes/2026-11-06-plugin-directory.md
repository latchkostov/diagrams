## Plugin directory packaging and explicit HTML passwords

The plugin and standalone skill ZIP now use the same explicit password input: prefer
`--password-file <path>` to a user-created local UTF-8 file; `--password <value>` is the fallback
and exposes the value in the conversation, shell history and process list. The exporter reads
only the supplied path, strips one final line ending, and never prompts, reads a password from
the environment, invents one or saves one in plugin configuration.

The generated viewer ships plain JavaScript statements and CSS, real WOFF2 fonts and partitioned
icon JSON. The exporter joins their original bytes and encodes fonts only when creating HTML.
The old single-template viewer and the assembled viewer are byte-identical; three public examples
also compare complete exports byte for byte. Every JavaScript chunk parses independently.
Production asset pruning follows downloadable JSON manifests as well as HTML, so the site's
split viewer keeps its CSS; truly unreferenced stylesheets are still removed.

| Asset                                               |  Before (bytes) |                                                       After (bytes) |
| --------------------------------------------------- | --------------: | ------------------------------------------------------------------: |
| Viewer template HTML                                |       1,835,009 |                                                               9,239 |
| JavaScript (formerly inside HTML)                   |       1,529,767 | 123,592 / 261,918 / 261,939 / 250,873 / 260,680 / 260,530 / 110,218 |
| CSS (formerly inside HTML, including encoded fonts) |         296,073 |                                                             212,189 |
| WOFF2 fonts                                         | embedded base64 |                                                     39,788 / 23,128 |
| Icon JSON                                           |         413,880 |                                    32-byte index; 261,312 / 152,570 |
| Application module                                  |         121,010 |                                                             121,010 |
| Specification JSON                                  |          80,333 |                                                              80,333 |

The original skill ZIP was 819,356 bytes; the split package is 826,813 bytes, below both
the 835,000-byte cap and the existing 828,856-byte headroom assertion. Limits remain unchanged.
Tests cover the whole installed plugin: at most 512 files, each at most 262,144 bytes, with no
base64 run longer than 1,024 characters in text files. The directory's
[pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist#files-in-the-plugin-folder)
documents the 256 KiB text-file and 512-file limits.

The owner-requested manifest version is `1.0.0`. All four URL listing fields remain: they are
documented by the [manifest reference](https://code.claude.com/docs/en/plugins-reference#directory-listing-fields).
Generation does not edit the manifest version. A fixed version pins Claude Code's cached
git-marketplace installation until a later version change; directory updates follow its review process.

Two goldens intentionally change: `node/skill/files.json` fingerprints the revised password
instructions in `SKILL.md` and `reference/outputs.md`; `node/skill/usage.json` records the two explicit
password arguments. HTML export and viewer goldens remain unchanged. No diagram output is re-recorded.

Local CLI validation passes with no findings. The CLI explicitly excludes the directory safety scan
and policy review, so this result does not certify that the hosted policy holds have cleared.
