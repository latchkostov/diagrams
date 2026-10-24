# Outputs: what to hand back

Start with a validated, laid-out `<name>.diagram.json`. Ask which output the user wants unless
already specified; offer these in order:

| Output                  | Who can open it                   | Internet        | Editable |
| ----------------------- | --------------------------------- | --------------- | -------- |
| Interactive HTML        | anyone with the file              | no              | no       |
| Password-protected HTML | anyone with the file and password | no              | no       |
| Diagram file            | anyone with the file              | to open the app | yes      |
| PNG or SVG              | anyone with the file              | to open the app | no       |
| Share link              | **anyone with the link**          | yes             | yes      |

## Choosing for the user

The app's draw.io export preserves fixed sides and hand-shaped routes when re-imported. Foreign draw.io
routes are dropped with an import report because their nodes are rescaled. Mermaid has no line geometry:
export drops fixed sides and routes without a warning, including from its metadata comment.

For work, employer, team, client or customer systems, or internal names, hosts, accounts or clusters,
recommend HTML or a diagram file. Set `"private": true`: the app keeps it on the device, with no
share links, cloud saves or AI tools. Offer HTML encryption because files get forwarded.
Private diagrams never get share links, including hand-built ones; `share-link.mjs` refuses them.
Files remain the user's choice.

For public or personal diagrams, any output is fine. Several outputs are fine too: a diagram file
for editing and HTML for the team. If nobody can answer, make HTML and explain the alternatives.

A link with a password is made **in the app only**: open the diagram and use
**File > Share… > Link with password…**. Anyone with both can open it; a Private diagram gets no link.
The app lists public links and embeds last.

## Interactive HTML file

```sh
node scripts/export-html.mjs <file> [--out <path>] [--theme light|dark] [--banner "text"] [--title "text"] [--sim <id>] [--no-autoplay] [--password] [--force]
```

This is the app's **File > Export as > Interactive HTML…** output: one read-only file with pan,
zoom, fit and simulation playback, selection, pause, speed and trace. It bundles the diagram,
viewer, simulations, used icons and fonts under strict CSP. It makes **no network requests**,
works offline/from disk and stores nothing in the browser. The script also works offline.
`scripts/lib/` contains the generated viewer and icons; don't read these large files.

- Validation runs first; the script refuses a diagram the viewer cannot open.
- `--out`: an HTML file or a folder; default `<title>.html` beside the diagram. Taken default names
  become `<title> (2).html`, with a stderr notice. An explicit existing file requires `--force`.
- `--theme`: light (default) or dark. `--banner`: a top line; use `"Confidential: internal use only"`
  for work. `--title`: overrides the diagram title for the page and filename.
- `--sim <id>`: initially selected simulation (default first). `--no-autoplay`: open static.
  Every simulation remains included.

Give the path and say anyone with the file can open it. Recommend sharing where the team already
controls access: SharePoint, Confluence, an intranet or private repository. Any modern browser
can open the file from disk.

### A password on the file

`--password` uses the app's AES-256-GCM encryption with PBKDF2-SHA-256 at 600,000 iterations.
Nothing, including the title, is readable without the password. The filename is
`Diagram (password protected) <random>.html` to avoid collisions. The file asks for the password,
reports wrong passwords and decrypts offline in the browser without network access.

Never ask for a password in chat, invent one or put it in a command: transcripts, shell history
and process lists retain it. The script refuses `--password=…` and a following password argument.
It reads `LIVEDIAGRAMS_HTML_PASSWORD` when already set by the user; otherwise a terminal prompt
asks twice without echoing. Only run it yourself when that environment variable is already set;
never set or echo it. Otherwise give the user:

```sh
node <skill folder>/scripts/export-html.mjs <file> --password
```

Require at least 8 characters; several random words are good. Weak passwords produce a warning.
Tell the user to send the password separately. It cannot be recovered; if lost, export again.
Anyone with the file and password can open it.

## Diagram file

Give the `.diagram.json` path. It preserves simulations and remains editable. Open at
[livediagrams.dev](https://www.livediagrams.dev) using **File > Open…** or drop it onto the page.
The browser reads it; nothing is uploaded.

## Image

No script renders images. Never pass off hand-drawn SVG or ASCII art as an export. Explain:

1. Open the diagram at [livediagrams.dev](https://www.livediagrams.dev) with **File > Open…**.
2. Use **File > Export PNG** for a 2× PNG, or **File > Export as > Image…** for PNG/SVG, sizing
   and transparency.

A browser tool can screenshot an Interactive HTML file from disk; label that output a screenshot.

## Share link

```sh
node scripts/share-link.mjs <file> [--base <url>]
```

It prints `https://www.livediagrams.dev/#d=…`. The diagram is in the URL fragment, which browsers
never send to servers. Nothing is uploaded, but **anyone with the link can open it**; chat history,
email and previews retain it. Say so, and give a Markdown link titled with the diagram's title.
If the script warns about exceeding 8,000 characters, offer the diagram file: chat apps may
truncate links. Invalid and Private diagrams are refused.
