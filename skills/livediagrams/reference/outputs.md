# Outputs: what to hand back

Every output starts from the same validated, laid-out `<name>.diagram.json`. Ask which one the user wants unless
they already said, and offer them in this order.

| Output                | Who can open it               | Needs the internet | Editable       |
| --------------------- | ----------------------------- | ------------------ | -------------- |
| Interactive HTML file | only people who have the file | no                 | no (read-only) |
| Diagram file          | only people who have the file | to open the app    | yes            |
| Image (PNG or SVG)    | only people who have the file | to open the app    | no             |
| Share link            | **anyone who has the link**   | yes                | yes            |

## Choosing for the user

- **Work and company diagrams.** If the user mentions their work, employer, team, a client or customer, or the
  system sounds internal (internal service names, real hosts, account or cluster names), recommend the
  Interactive HTML file or the diagram file. Set `"private": true` in the diagram: the app then keeps it on the
  device when it's opened (no share links, no cloud saves, no AI tools).
- **Private diagrams** (`"private": true`) never get a share link. `share-link.mjs` refuses them; don't build one by
  hand either. The HTML file and the diagram file are fine: handing over a file is the user's own choice.
- **Public or personal diagrams** (a blog post, a tutorial, an open-source project): any output is fine. A share link
  is the quickest to pass around.
- **Several at once** is fine: the diagram file to keep editing, plus the HTML file to send to the team.
- If you can't ask (no one to answer), make the HTML file and say how to get the others.

## Interactive HTML file

```sh
node scripts/export-html.mjs <file> [--out <path>] [--theme light|dark] [--banner "text"] [--title "text"] [--sim <id>] [--no-autoplay]
```

One self-contained `.html` file, the same file as the app's **File > Export as > Interactive HTML…**: the diagram
read-only (pan, zoom, fit) with live playback of its simulations (pick one, play, pause, speed, trace). It holds the
viewer, the diagram, its simulations, the icons it uses and the fonts, under a strict Content-Security-Policy:
**it makes no network requests at all**, works offline and from disk, and stores nothing in the browser. It's
about 1.2 MB.

- It validates the diagram first, like `validate.mjs`, and refuses to write a file the viewer wouldn't open.
- `--out`: a file ending in `.html`, or a folder for `<title>.html`. By default it writes `<title>.html` beside the
  diagram.
- `--theme`: `light` (default) or `dark`.
- `--banner`: a line across the top, such as `"Confidential: internal use only"`. Add one for work diagrams.
- `--title`: the page's title and file name (the diagram's title by default).
- `--sim <id>`: the simulation that plays when the file opens (the first one by default). `--no-autoplay` opens the
  static diagram instead. Every simulation is in the file either way.
- The script itself works offline: the viewer and the icons are bundled in `scripts/lib/`. Don't read those files;
  they're large and generated.

Tell the user where the file is and that only people who have it can open it, so they should share it where their
team already controls access (SharePoint, Confluence, an intranet, a private repository) or open it from disk. It
opens in any modern browser.

## Diagram file

The `.diagram.json` you wrote. It's lossless (simulations included) and the way to keep editing: at
[livediagrams.dev](https://www.livediagrams.dev), **File > Open…** (or drop the file on the page). The app reads it
in the browser; nothing is uploaded. Give the user the path.

## Image

No script here renders an image, so don't make one up (no hand-drawn SVG or ASCII art passed off as the export).
Tell the user how to export it from the app:

1. Open the diagram file at [livediagrams.dev](https://www.livediagrams.dev) with **File > Open…** (read in the
   browser, not uploaded).
2. **File > Export PNG** for a 2× PNG, or **File > Export as > Image…** for PNG or SVG with a size and a transparent
   background.

If you have a browser tool, you can open the Interactive HTML file from disk and take a screenshot instead: say it's
a screenshot.

## Share link

```sh
node scripts/share-link.mjs <file> [--base <url>]
```

It prints a `https://www.livediagrams.dev/#d=…` link. The whole diagram travels in the link's `#` fragment, which
browsers never send to a server, so nothing is uploaded. But **anyone who has the link can open the diagram**: chat
history, email and link previews keep it. Say so when you give it.

- Give it as a Markdown link titled with the diagram's title.
- If the script warns that the link is over 8,000 characters, chat apps may cut it off: offer the diagram file
  instead.
- It refuses a diagram with errors and a private diagram.
