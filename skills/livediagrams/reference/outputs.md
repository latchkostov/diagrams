# Outputs: what to hand back

Start with a hand-checked `<name>.diagram.json`. Ask which output the user wants unless
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
Private diagrams never get share links, including hand-built ones.
Files remain the user's choice.

For public or personal diagrams, any output is fine. Several outputs are fine too: a diagram file
for editing and HTML for the team. If nobody can answer, return the diagram file and explain the alternatives.

A link with a password is made **in the app only**: open the diagram and use
**File > Share… > Link with password…**. Anyone with both can open it; a Private diagram gets no link.
The app lists public links and embeds last.

## Making other outputs in the app

This plugin hands back the diagram file. For offline Interactive HTML (with or without a password),
an image or a requested share link, open it at [livediagrams.dev](https://www.livediagrams.dev) with
**File > Open…** or drag it onto the page. The browser reads it; nothing is uploaded.
Use the app's **Export** menu for HTML and images, or **File > Share…** for links.
Never claim the plugin produced HTML or a link. Never fake an image or pass off hand-drawn SVG as an export.

Anyone with an unencrypted file can open it. For company content, offer **Require a password** when
exporting HTML in the app: anyone with the file and password can open it. Ask the user to enter their
password in the app, never invent, save or reuse a plugin password. Send the password separately;
it cannot be recovered. Public links are for requested public content only; anyone with the link can open it.
