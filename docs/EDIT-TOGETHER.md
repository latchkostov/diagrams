# Edit together

Edit a diagram with other people at the same time, each in their own browser. There are no accounts and no server
of ours: the browsers connect to each other, and the diagram travels between them end-to-end encrypted.

Edit together is part of copies built with it (`VITE_ENABLE_COLLAB=1`). On livediagrams.dev it is turned on by the
site's owner. A self-hosted copy has it only if whoever builds that copy turns it on
([SELF-HOSTING.md](SELF-HOSTING.md#edit-together)).

## Start a room

1. Open the diagram, then choose **File ▸ Share… ▸ Edit together…**. You can also press Ctrl+K and type "Edit
   together". The row comes after Link with password, because anyone with a room's link can edit.
2. Read what the dialog says, and pick the name the others will see (you get one like "Anonymous Heron" until you
   change it). Then choose **Start room**.
3. Copy the room link and send it the way you'd send a password: a direct message to the people who should edit, not
   a public channel.

The chip by the title shows the room's state, for example "Room open · waiting for others", "2 here" or
"Reconnecting…". Its menu lists who is in the room. It also has **Copy room link** and **Leave room**.

## Join a room

Open the link someone sent. Before anything connects, a dialog asks whether to join. It says who can see your IP
address and which services the room uses. Choose **Join** to connect, or **Don't join** to leave nothing behind.
The diagram arrives from someone already in the room, and your own diagrams aren't changed.

## While you're in a room

- **Edits** reach everyone within moments. Each person has their own Undo, which undoes only their own changes.
- **Presence.** You see the others' selections as outlines in their colour, with their name, and their pointers
  over the canvas. A pointer that stays still for a few seconds hides. Nobody else's actions move your view or take
  your keyboard.
- **Names aren't verified.** Anyone can type any name, so treat "(unverified)" literally.
- **Up to 8 people** can be in one room. Each browser connects directly to every other browser.
- **Reloading** the tab keeps you in the room. The tab remembers the room until you leave or close the tab.
- **Recordings, presentations, prints and image exports** never show the others' outlines, pointers or names.

## Leave

Choose **Leave room** in the chip's menu. Your copy stays in **Your diagrams**, and the others carry on. A room
lasts while at least one person is in it. When the last person leaves, it's gone, and its link no longer finds
anyone. To work together again, start a new room.

## When it can't connect

| What you see                                                      | What it means                                                              | What to do                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| "Could not connect to this room. Check your connection…"          | Nothing answered: the services that introduce browsers, or the others      | **Retry**, or **Save a file copy** and send the file                        |
| … followed by "Your network or theirs blocks direct connections." | The browsers found each other, but a firewall, VPN or hotspot blocked them | Try another network (a phone hotspot or home Wi-Fi), or send a file instead |
| "No one else is in this room right now…"                          | Everyone else left, or their network blocks it                             | Ask them to rejoin, or start a new room                                     |
| "Reconnecting…"                                                   | A connection dropped                                                       | Wait; your edits stay on this page                                          |
| "This room link is damaged or incomplete"                         | The link was cut off (chat apps sometimes do)                              | Ask for the link again                                                      |

Some company networks, VPNs and mobile hotspots block the direct connections rooms use. livediagrams.dev doesn't
run a relay server for them. A self-hosted copy can configure its own (a TURN server).

## Privacy

- **The diagram is end-to-end encrypted.** The key is in the link, after the `#`, which browsers never send to a
  server. The services a room uses see encrypted messages only, never the diagram, the link or any key.
- **IP addresses.** Everyone in the room can see your IP address, because browsers connect directly. The services
  that introduce the browsers also see it: on livediagrams.dev, the public WebTorrent trackers
  `tracker.openwebtorrent.com` and `tracker.webtorrent.dev`, and Cloudflare's STUN server. They are run by other
  people, and the join and start dialogs list them every time.
- **Nothing is sent to us.** There is no server of ours in a room, no account and no analytics.
- **Private diagrams can't be shared in a room.** The row explains why. A diagram that turns private while it's in a
  room leaves the room, and its copy stays on this device.
- **On this device.** While you're in a room, the app keeps an encrypted copy of the room's diagram in this
  browser's storage, so a reload loses nothing. It keeps the room's link in this tab only. **File ▸ Privacy ▸ Clear
  everything on this device…** removes both.
- **Anyone with the link can edit.** There are no roles yet, and nobody can be removed from a room. If a link
  leaks, everyone should leave, and the people who should edit should start a new room.
- **Not yet independently reviewed.** The encryption design (its keys, messages and link format) hasn't had an
  independent cryptographic review yet. That is one reason Private diagrams stay out of rooms. For anything
  sensitive, use a file or a link with a password.

The details are in the [threat model](research/collaboration-threat-model.md) and the
[privacy audit](PRIVACY-AUDIT.md).
