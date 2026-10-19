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

## Watch Live together

Whoever started the room is its **host**. One person at a time **drives** Live for the room: the host, unless
they let someone else (see **Hosts and requests** below). Only Live on the room's own diagram is shown or followed. Open Live on any other diagram, a Private one included, and nothing of it
reaches the room: not its simulation's name, not its run.

- **The offer.** When the host turns on Live, everyone else gets a short note: "Sam is showing Live: Black
  Friday", with **Watch**. Nothing happens on its own: someone in the middle of an edit stays where they are. The
  chip's menu offers **Watch Sam's Live** too.
- **Watching.** Your page opens the room's diagram if it isn't already showing it, goes into Live and plays the
  host's run, about half a second behind them. Whatever the
  host does reaches you on the same simulated moment: play, pause, speed, scrubbing, another simulation, a tweak
  (Replicas, a slowdown, a fault, an injection) and a change in Inputs & capacity. The chip says "Following Sam".
  Each browser runs the same simulation itself, and the host's checks every few seconds catch any drift, so your
  run matches theirs exactly.
- **Your own view.** The view stays yours: the host panning or zooming doesn't move it. To follow it anyway, turn on
  **Follow Sam's view** in the chip's menu. Your own pan or zoom turns it off again, and so does moving to a node
  with the keyboard. Hover, the inspector, traces
  and the event log are your own too.
- **Joining late, and new runs.** If you start watching in the middle of a run, your page replays it from the start
  to catch up ("Catching up… 0:42 of 3:10"). The same happens when the host restarts, picks another simulation or
  plays a finished run again. A long run catches up a few moments at a time, so the page stays responsive.
- **Watch on my own.** This, in the chip's menu, keeps your run where it is and makes it yours to change. While you
  follow, the live bar's controls that change the run (play, restart, speed, the simulation, the timeline) don't
  act: using one says "Sam is driving", with **Ask to drive** and **Watch on my own**. So does a change made another
  way (Space, a right-click tweak), before it reaches your run. The event log, traces, Record video and slow motion
  are yours as ever; recording "from the start" replays the run from its start, so you watch on your own from there.
- **Notes and your view.** A narration note that focuses part of the diagram moves your view, as it does on your
  own, unless you've moved the view yourself.
- **If the host's connection drops,** your run waits where it is: "Sam's connection dropped. Waiting…". It goes on
  when they're back, and asks the host for the run again if it missed anything meanwhile (a restart included).
  Nobody else takes over. If the host leaves the room, or stops showing Live, you keep watching on your own.
- **When it can't follow.** A browser that drifts from the host's run twice, can't get the run from the host, or
  finds the host on a different version of Live Diagrams gets a message, and you watch on your own. A run too large to
  send (a very long one) isn't shown; the host is told, and their next run is shown.
- **Trust, for now.** Watching is cooperative. Everyone in the room shares one key, so a page that's been modified
  could send Live commands, or claim to be the host. A normal page only follows the room's creator, checks every
  message in full before using it, and ignores one that isn't exactly what Live sends, or that asks for more work
  than Live ever does. Signed roles are planned.

## Hosts and requests

- **Ask to drive.** While you follow, choose **Ask to drive** in the chip's menu (or in "Sam is driving"). The host,
  and any co-host, get a card under the chip: "Heron asks to drive Live", with **Let them** or **Not now**. A
  request nobody answers in a minute counts as declined, and you're told either way. When they let you, the run
  passes to you at the moment it's at: you drive the same run on, and the host follows it like everyone else.
- **Show your own Live.** If you're in Live on your own, on the room's diagram, choose **Show my Live to the room…**.
  The host is asked "Heron wants to show 'Retry storm'", with **Show everyone** or **Not now**. Yes makes you the
  driver of a new run that starts from your simulation, unsaved drafts included.
- **The host's menu.** In the chip's menu the host sees each person with a menu: **Make co-host** (or **Not a
  co-host**), **Let them drive** (or **Take back Live**) and **Make host**. Making someone host makes you their
  first co-host; who drives stays as it was. The people list says who's the host, a co-host and driving.
- **Co-hosts** see requests and can answer them too. The host keeps the roster; while the host is away, the last
  roster stands, so co-hosts still get requests and their yes still passes the run on.
- **A reload keeps the roles.** Who hosts now, the co-hosts and who drives survive anyone's reload: a host who was
  handed the room still hosts after reloading, and one who handed it on doesn't take it back. A duplicated tab is a
  new person in the room, with no role.
- **When the host leaves.** **Leave room** hands the room to the earliest co-host, or, with none, to whoever has
  been here longest, and the run to whoever drives next. A dropped connection hands nothing over: everyone
  following waits, as above, and nobody is promoted.
- **Already in Live when the room opens.** If the host's run has changed in ways its start can't describe (Inputs
  changed since it began, say), it starts over at the same moment, so the room watches the same run. The host is
  told.
- **Still cooperative.** Roles are what each person's page says: a modified page could ignore a "Not now", or claim
  to be the host. A normal page follows these rules. Signed roles, which make them hold, come next.

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

## Thanks

On livediagrams.dev, rooms find each other through two free public WebTorrent trackers, run by volunteers:
[OpenWebTorrent](https://openwebtorrent.com/) (`tracker.openwebtorrent.com`) and
[webtorrent.dev](https://tracker.webtorrent.dev/) (`tracker.webtorrent.dev`, running Aquatic; it isn't associated
with WebTorrent LLC). Browsers learn their public address from Cloudflare's free STUN service. Thank you to everyone
who runs them.
