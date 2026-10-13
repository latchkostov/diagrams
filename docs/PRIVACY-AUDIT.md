# Privacy audit

October 2026, against `77835cd` (#76). The question: can a diagram's content (its title, labels, notes, properties,
simulations, thumbnails) leave the page, or stay behind, in a way the person didn't intend? The owner uses Live
Diagrams for their employer's real processes, so the bar is "nothing ends up anywhere public or unintended, and
nothing to freak out about".

The method: every path out of the page and into storage was traced in the source (the WebMCP tools, every export,
the embeds, the storage providers, the address bar, `localStorage`, the clipboard, console and errors), then each
bug got a fix and a test that fails without it (unit tests, and `tests/e2e/privacy-audit.spec.ts` on the production
build: no request outside the origin, and no request URL carrying the diagram's words). Only public examples and
synthetic diagrams were used.

**The headline: nothing High.** No path sent a Private diagram to a server, an AI service or a public URL. The
Medium findings were content reaching the browser's history (which browsers sync), a third party's script running
beside a Private diagram, an embed showing a diagram marked private, AI conversations outliving their diagram, an
agent able to write into a Private diagram, and no way to wipe this browser. All are fixed.

## What leaves your browser, and when

Accurate for this branch. "The diagram" means its whole content unless the row says otherwise.

| What                                                                   | Where it goes                                                                                                       | When                                                                                                                    | Private diagrams                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Page loads (HTML, JS, CSS, fonts, icons)                               | livediagrams.dev (Vercel), with the usual IP and user agent                                                         | Opening the app; lazy chunks on first use. No URL carries diagram content (checked: icons by stencil id, fonts bundled) | Same                                                                                      |
| Analytics, telemetry, error reports                                    | Nowhere: there are none (no Vercel Analytics, Speed Insights, web-vitals, `sendBeacon`, Sentry or `onerror` sender) | Never                                                                                                                   | Same                                                                                      |
| Share link `#d=` / password link `#e=`                                 | Whoever you send it to. Never a server (the fragment isn't sent). Your browser's history keeps the visited link     | Copy share link / Copy link with password, and when someone opens it                                                    | Never made; a link embed refuses one marked private                                       |
| Address bar and history                                                | Your browser's history, and its sync (Chrome, Edge)                                                                 | Every view: `?view=canvas&example=<slug>` (your diagrams are `my-<random>`), live view's `live=1&sim=<id>`              | `live=1` only: no simulation id. Tab title is always "Live Diagrams"                      |
| Google Drive, OneDrive, Dropbox                                        | The provider, from your browser                                                                                     | Save to ▸ / Open from ▸ (the diagram, its file name from the title). Google's scripts load when the File menu opens     | No saves. Google's scripts don't load for the File menu; only on Open from ▸ Google Drive |
| AI agents in your browser (WebMCP)                                     | Your browser's assistant, under its own terms                                                                       | When it calls a tool (describe, check, edit, share link)                                                                | No tools are published; every call re-checks                                              |
| Copy for AI, Advanced's prompts                                        | Your clipboard, then wherever you paste                                                                             | When you click                                                                                                          | Off                                                                                       |
| Chrome's built-in model                                                | Nowhere: it runs on the device                                                                                      | When you send a request                                                                                                 | Only once you allow it for that diagram                                                   |
| Dictation (the mic)                                                    | Your browser's speech service: in Chrome usually Google's servers, which get the audio                              | While dictating, unless the browser can recognise on the device (then nothing leaves). The first cloud use says so      | On-device recognition only, or none                                                       |
| Copy (Ctrl+C) of nodes                                                 | Your system clipboard as JSON (and any clipboard history or sync your OS has)                                       | When you copy                                                                                                           | Carries `"private": true`; a paste makes the target private (or is refused)               |
| Files: .diagram.json, Interactive HTML, image, video, draw.io, Mermaid | Your device, then wherever you put them                                                                             | When you export                                                                                                         | Allowed (your act); the importable ones say `"private": true`                             |
| Host-supplied embed                                                    | Stays in the host page and the frame's memory                                                                       | While the page is open                                                                                                  | Allowed: it's never in a URL or storage                                                   |
| This browser's storage                                                 | `localStorage` on this device, unencrypted                                                                          | Autosave, Your diagrams, the shared slot, AI conversations, settings                                                    | Same (stays on the device); **Clear everything on this device…** wipes it                 |

## Paths checked

1. **Browser history and sync.** Opening `#d=` clears the fragment with `replaceState` before decoding; `#e=` once
   it's unlocked; a diagram that turns private loses any fragment. No code writes a diagram into the URL. "Keep the live
   link in the address bar" (#32) is the query string (`live=1&sim=<id>`), deliberate, so a live link can be copied;
   the gap was the simulation id (finding 1). `pushState` (switching views, the stencil library's "add to diagram")
   carries the current fragment into the new entry: only an `#e=` still waiting for its password can be there (a
   `#d=` is cleared before anything runs), it's encrypted, and the browser already recorded it when the link was
   visited, so stripping it would add nothing (P9). The main app never sets `document.title`: the tab
   always says "Live Diagrams" (or the self-host brand), so a neutral title for Private diagrams already holds. The
   one place a title changed was the password-protected HTML viewer (finding 2). Not fixable by the app: the browser
   records the visited `#d=` link in its history before any script runs (documented in `privacy.html`).
2. **Local persistence.** Inventory (every key starts `diagrams.`): the library (`doc.v1:`, `library-entry.v1:`,
   the old `library.v1` index, `library-deleted.v1:` markers), autosaves (examples too), the shared slot, file
   destinations (`bindings.v1`), AI conversations (`ai-thread.v1:<session>`, with up to ten full copies of the diagram
   for Revert to here), palette recents, recent stencils (catalog ids only), settings, the Lab's pasted JSON. Thumbnails
   are geometry only (boxes and colours, no text). Undo history, viewport, check results and OAuth tokens are memory
   only. Gaps: findings 5, 6, 9 and 14.
3. **Third parties.** Only Google Drive loads outside scripts (Identity Services and the Picker), on the File menu's
   warm-up, which ran for Private diagrams too (finding 3). OneDrive and Dropbox only `fetch`, on an explicit action.
   No embed or viewer renders the File menu. `Referrer-Policy: strict-origin-when-cross-origin` (now also a meta tag,
   finding 13); the HTML export has `no-referrer`. No service worker, Cache Storage or IndexedDB. Fonts and icons are
   bundled; no URL is built from a label.
4. **Errors and crashes.** `console` output names modules and errors, never sends them; error boundaries render
   locally. Toasts show titles on screen only. No error reporting or analytics of any kind (searched the source,
   `index.html`, `public/`, `vercel.json` and the dependencies).
5. **AI.** WebMCP tools are registered only while `canUseAiTools` holds, and every call re-checks. Async tools:
   `check_diagram` (simulations) re-checks the same document after each wait (#76); `get_share_link` re-checks after
   encoding; plain `check_diagram` re-checks privacy after its chunk loads; `new_diagram` wrote before it checked
   (finding 7). Copy for AI and Advanced's copy, Apply and fix-up prompts check at the click. The on-device model checks
   at send, before inference and before commit, and cancels on a switch; its no-`clone()` fallback shared context
   (finding 8). Dictation asks for on-device recognition (`processLocally`) and, for a Private diagram, refuses the
   cloud service; elsewhere Chrome's service gets the audio (finding P3).
6. **Exports.** Every export goes through `current()`, which writes `"private": true`; draw.io and Mermaid carry the
   marker and re-import private (round-trip tests exist). The `.diagram.json` keeps it; `onDevice` is never written.
   Images: no PNG text chunks; html-to-image keeps attributes, so SVGs carry node ids (`data-id`) and the check markers'
   tooltips (finding 11). Video: tab capture with no audio, only a duration patched in. Interactive HTML: storage
   swapped for memory before any module runs, `connect-src 'none'`, no links out; but the plain file holds the whole
   diagram JSON, properties and notes included (finding P1).
7. **Embeds.** `?embed=1#d=` rendered a diagram marked private and put it back in its "Open in" link (finding 4).
   Host-supplied embeds: messages accepted only from `window.parent` at `hostOrigin`; every reply goes to
   `hostOrigin` (never `*`, in the frame and the web component); sizes and rates bounded; the diagram is forced
   private. `hostOrigin` rejects `*`, `null`, `javascript:`, paths and credentials (plain `http:` is allowed, P6). The
   embeds' CSP still allowed the storage providers (finding 12).
8. **Self-host.** With every switch on (`locked`) and the internal build, `tests/e2e/self-host*.spec.ts` record every
   request and the CSP violations: nothing leaves the origin. Both ran green on this branch.
9. **Clipboard.** Copy carries `private: true`; pasting into a non-private diagram makes it private with the toast
   "Pasted from a private diagram, so this one is private now…", or, into an example or a shared diagram, refuses
   with a reason. That is the simple, sensible behaviour asked for, and it already existed (unit and e2e tests). What
   remains is the OS clipboard itself (P2).

## Findings and fixes

| #   | Severity        | Finding                                                                                                                                                                                                    | Fix                                                                                                                                                                            | Test                                                                                             |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | Medium          | A Private diagram's simulation id went into the address bar (`&sim=`), so into history and sync. Ids are made from its words: a storm's is `storm-<node label>`, and people and agents write their own     | Live view writes `live=1` only for a Private or local-only diagram, and drops `sim` when a playing diagram turns private (`LiveSession.tsx`, `privateDiagram`)                 | e2e: privacy-audit "simulation id never goes in the address bar", "turned private while playing" |
| 2   | Medium          | A password-protected Interactive HTML file set the tab title to the diagram's after unlocking, so the protected title reached history (and sync, on an https host)                                         | The title stays "Diagram (password protected)" (`ViewerApp.tsx`); the canvas's label still names it for screen readers                                                         | e2e: html-export (locked file)                                                                   |
| 3   | Medium          | Opening the File menu loaded Google's Identity Services and Picker scripts (full page access) while a Private diagram was on screen                                                                        | No provider warm-up while the open diagram is private (`useInterop.tsx` `preload`); Open from ▸ Google Drive still loads them on that click                                    | e2e: privacy-audit "warms up storage providers … never for a private one"                        |
| 4   | Medium          | `?embed=1#d=` (and `#e=` once unlocked) rendered a diagram marked private, and its "Open in" link carried it again                                                                                         | A link embed refuses it: "This diagram is private, so it can't be shown in an embed…", with no link out (`EmbedView.tsx`)                                                      | e2e: privacy-audit "a link embed refuses a diagram marked private"                               |
| 5   | Medium          | A diagram's AI conversation (requests, labels, up to ten full copies) stayed after the diagram was deleted, or the shared slot was replaced                                                                | Delete removes it (Undo restores it); replacing or clearing a slot drops the old session's (`diagramIO.ts`)                                                                    | unit: diagramIO.test.ts                                                                          |
| 6   | Medium          | No way to wipe this browser short of the browser's own site settings; example edits, file destinations, palette recents and the Lab's JSON had no delete at all                                            | **File ▸ Privacy ▸ Clear everything on this device…**, one confirmation (Cancel default), removes every `diagrams.` key, reloads every open tab, writes nothing on the way out | unit: clearDevice.test.ts; e2e: privacy-audit "Clear everything"                                 |
| 7   | Medium          | `new_diagram` (WebMCP) gave the new diagram the agent's title before checking privacy: with New diagrams are private on, an agent wrote into a Private diagram; on a slow open it renamed the previous one | It checks first, writes only into the diagram it opened and only while AI may change it, and never falls back to the previous editor (`newDiagram.ts`)                         | unit: newDiagram.test.ts                                                                         |
| 8   | Medium (latent) | Without `clone()`, on-device requests ran in the page's one primed session, so a Private diagram's prompt stayed in context for later requests on any diagram                                              | The primed session is dropped after such a request (`useOnDeviceRequest.ts`)                                                                                                   | e2e: ai-ondevice "without clone()"                                                               |
| 9   | Low             | Ctrl+K's recent commands kept a Private diagram's node and simulation ids (its words), after the diagram was gone                                                                                          | Not remembered for private diagrams (`recent.ts` `rememberable`)                                                                                                               | unit: rank.test.ts; e2e: privacy-audit "Ctrl+K never remembers"                                  |
| 10  | Low             | Copy Mermaid and draw.io on a Private diagram suggested pasting into mermaid.live, GitHub, Notion or app.diagrams.net                                                                                      | The toast says "This diagram is private: keep it where your team controls access."                                                                                             | e2e: privacy-audit "toasts never point at public sites"                                          |
| 11  | Low             | With the Checks card open, image exports captured its markers, and SVGs their tooltips (the findings' words)                                                                                               | Markers are left out of exports (`image.ts`)                                                                                                                                   | e2e: privacy-audit "no check markers"                                                            |
| 12  | Low             | Embeds' CSP allowed Google's scripts and frames and every provider endpoint, none of which an embed uses                                                                                                   | Embeds allow this site only (`scripts/security-headers.ts`, `vercel.json`)                                                                                                     | unit: securityHeaders.test.ts                                                                    |
| 13  | Low             | `index.html` had no referrer meta: a self-hosted copy served without the headers fell back to the browser's default                                                                                        | `<meta name="referrer" content="strict-origin-when-cross-origin">`                                                                                                             | unit: securityHeaders.test.ts                                                                    |
| 14  | Low             | The old all-in-one library index (written once at migration) kept deleted diagrams' titles and thumbnails                                                                                                  | Delete takes the row out (Undo still lists it from its own record)                                                                                                             | unit: diagramIO.test.ts                                                                          |

## Proposals (the owner's call)

- **P1 (Medium). What a plain Interactive HTML file holds.** Without a password it embeds the whole diagram as JSON:
  properties (simulation inputs, but also secret names, connection details people type in), notes, the description,
  check ignore reasons and fields kept from an import. The viewer shows none of the properties, so a reader of the page
  source sees more than the reader of the page. Options: say so in the dialog ("The file holds the whole diagram,
  properties and notes included"), or an Options checkbox **Leave out properties and notes** (simulations that need
  the properties would then run on defaults). With a password, all of it is encrypted.
- **P2 (Low). The system clipboard.** Ctrl+C on a Private diagram puts its nodes on the OS clipboard as readable JSON,
  where Windows clipboard history (and its cross-device sync, if on) or a clipboard manager keeps them. Options: copy
  a Private diagram's nodes inside the app only (paste works in this tab; other tabs and apps get nothing), or say
  once "Copied to the clipboard: other apps can read it". Today's behaviour is what every editor does.
- **P3 (Low). Dictation's notice.** On a non-private diagram, Advanced's mic says "Your browser's speech service
  transcribes this (in Chrome, Google)" once per browser, then only "Listening…". A standing muted line while the
  service (not the device) is listening would keep it honest every time.
- **P4 (Low). Opening work links without history.** The browser records a visited `#d=` link before the app runs.
  File ▸ Import from ▸ Share link… (paste the link, nothing is visited) avoids that; the privacy page could recommend it for
  work links, or the share dialog could say "Opening the link adds it to the reader's browser history".
- **P5 (Low). `hostOrigin` over plain http.** The host-supplied embed accepts `http://` origins for any host (intranets
  use them). Restricting it to https plus localhost would stop a downgrade on hostile networks but break plain-http
  intranets.
- **P6 (Low). Hidden data in draw.io, Mermaid and SVG.** draw.io keeps properties, simulations and checks as custom
  attributes (Edit Data shows them); Mermaid's comment carries the description and checks; SVGs carry node ids and a
  dot-mode edge label's full text in a hidden span. A "Leave out hidden details" option, as in P1, would cover them.
- **P7 (Low). Turning a diagram Private keeps its earlier AI conversation** (agents' turns from before, shown, with
  Revert off). Making it private could offer **Clear conversation** in its toast.
- **P8 (Low). Small hardenings with no current leak:** remove the editor's legacy `exportJson` (unused: the File menu
  replaces it; it skips `"private": true`); re-check privacy when **Copy example request** is clicked (today it's
  only hidden while private); word the tools' refusal as "Private diagrams…" instead of "Local-only…"; hide the Lab
  (`?view=lab`) in production builds (its pasted JSON is stored, now wiped by Clear everything); embeds write
  theme and panel preferences to storage (no content).

- **P9 (Low). A password link's fragment in later history entries.** Switching views while an `#e=` link waits for
  its password copies the (encrypted) fragment into the new entries. The visit already recorded it, so this adds
  nothing readable; dropping it from pushed entries costs bytes at startup for no gain today.

- **P10. Release the skill's viewer.** Finding 2 is in the site's viewer (and the site's `/skill/` download) now, but
  the agent skill's committed copy (`skills/livediagrams/scripts/lib/viewer-template.html`) still retitles an unlocked
  file until `pnpm skill:release`, which also bumps the plugin's version.

## Not issues (checked)

- No telemetry, analytics, beacons, error reporting, service worker, CDN fonts or third-party scripts by default.
- OAuth tokens live in memory only; sign-in is a PKCE pop-up; `auth.js` stores nothing.
- Host-supplied embeds: origin lock both ways, never `postMessage(…, "*")`, bounded sizes and rates.
- Every link (share, password, embed code, `get_share_link`) asks `canShareAsLink` and asks again at the moment it acts.
- Interactive HTML: zero requests, no storage, no links out, `no-referrer`; a locked file shows nothing in the clear.
- Thumbnails carry no text.
- Private survives every round trip: copies, duplicates, pastes, `.diagram.json`, draw.io and Mermaid.
