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

| What                                                                   | Where it goes                                                                                                       | When                                                                                                                         | Private diagrams                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Page loads (HTML, JS, CSS, fonts, icons)                               | livediagrams.dev (Vercel), with the usual IP and user agent                                                         | Opening the app; lazy chunks on first use. No URL carries diagram content (checked: icons by stencil id, fonts bundled)      | Same                                                                                            |
| Analytics, telemetry, error reports                                    | Nowhere: there are none (no Vercel Analytics, Speed Insights, web-vitals, `sendBeacon`, Sentry or `onerror` sender) | Never                                                                                                                        | Same                                                                                            |
| Share link `#d=` / password link `#e=`                                 | Whoever you send it to. Never a server (the fragment isn't sent). Your browser's history keeps the visited link     | Share… ▸ Link with password… or Share link…, and when someone opens it                                                       | Never made; a link embed refuses one marked private                                             |
| Address bar and history                                                | Your browser's history, and its sync (Chrome, Edge)                                                                 | Every view: `?view=canvas&example=<slug>` (your diagrams are `my-<random>`), live view's `live=1&sim=<id>`                   | `live=1` only: no simulation id. Tab title is always "Live Diagrams"                            |
| Google Drive, OneDrive, Dropbox                                        | The provider, from your browser                                                                                     | Save to ▸ / Open from ▸ (the diagram, its file name from the title). Google's scripts load when the File menu opens          | No saves. Google's scripts don't load for the File menu; only on Open from ▸ Google Drive       |
| AI agents in your browser (WebMCP)                                     | Your browser's assistant, under its own terms                                                                       | When it calls a tool (describe, check, edit, share link)                                                                     | No tools are published; every call re-checks                                                    |
| Copy for AI, Advanced's prompts                                        | Your clipboard, then wherever you paste                                                                             | When you click                                                                                                               | Off                                                                                             |
| Chrome's built-in model                                                | Nowhere: it runs on the device                                                                                      | When you send a request                                                                                                      | Only once you allow it for that diagram                                                         |
| Dictation (the mic)                                                    | Your browser's speech service: in Chrome usually Google's servers, which get the audio                              | While dictating, unless the browser can recognise on the device (then nothing leaves). A line by the mic says so, every time | On-device recognition only, or none                                                             |
| Copy (Ctrl+C) of nodes                                                 | Your system clipboard as JSON (and any clipboard history or sync your OS has)                                       | When you copy                                                                                                                | Carries `"private": true`; a paste makes the target private (or is refused)                     |
| Files: .diagram.json, Interactive HTML, image, video, draw.io, Mermaid | Your device, then wherever you put them                                                                             | When you export                                                                                                              | Allowed (your act); the importable ones say `"private": true`                                   |
| Host-supplied embed                                                    | Stays in the host page and the frame's memory                                                                       | While the page is open                                                                                                       | Allowed: it's never in a URL or storage                                                         |
| This browser's storage                                                 | `localStorage` on this device, unencrypted                                                                          | Autosave, Your diagrams, the shared slot, AI conversations, settings                                                         | Same (stays on the device); **Clear everything on this device…** wipes it. Embeds write nothing |

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
   cloud service; elsewhere Chrome's service gets the audio (P3, built).
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

| #   | Severity        | Finding                                                                                                                                                                                                    | Fix                                                                                                                                                                                                                     | Test                                                                                             |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Medium          | A Private diagram's simulation id went into the address bar (`&sim=`), so into history and sync. Ids are made from its words: a storm's is `storm-<node label>`, and people and agents write their own     | Live view writes `live=1` only for a Private or local-only diagram, and drops `sim` when a playing diagram turns private (`LiveSession.tsx`, `privateDiagram`)                                                          | e2e: privacy-audit "simulation id never goes in the address bar", "turned private while playing" |
| 2   | Medium          | A password-protected Interactive HTML file set the tab title to the diagram's after unlocking, so the protected title reached history (and sync, on an https host)                                         | The title stays "Diagram (password protected)" (`ViewerApp.tsx`); the canvas's label still names it for screen readers                                                                                                  | e2e: html-export (locked file)                                                                   |
| 3   | Medium          | Opening the File menu loaded Google's Identity Services and Picker scripts (full page access) while a Private diagram was on screen                                                                        | No provider warm-up while the open diagram is private (`useInterop.tsx` `preload`); Open from ▸ Google Drive still loads them on that click                                                                             | e2e: privacy-audit "warms up storage providers … never for a private one"                        |
| 4   | Medium          | `?embed=1#d=` (and `#e=` once unlocked) rendered a diagram marked private, and its "Open in" link carried it again                                                                                         | A link embed refuses it: "This diagram is private, so it can't be shown in an embed…", with no link out (`EmbedView.tsx`)                                                                                               | e2e: privacy-audit "a link embed refuses a diagram marked private"                               |
| 5   | Medium          | A diagram's AI conversation (requests, labels, up to ten full copies) stayed after the diagram was deleted, or the shared slot was replaced                                                                | Delete removes it (Undo restores it); replacing or clearing a slot drops the old session's (`diagramIO.ts`)                                                                                                             | unit: diagramIO.test.ts                                                                          |
| 6   | Medium          | No way to wipe this browser short of the browser's own site settings; example edits, file destinations, palette recents and the Lab's JSON had no delete at all                                            | **File ▸ Privacy ▸ Clear everything on this device…**, one confirmation (Cancel default). Only the confirming tab deletes; every tab from before stops writing and starts over (see "How Clear everything works" below) | unit: clearDevice.test.ts; e2e: privacy-audit "Clear everything"                                 |
| 7   | Medium          | `new_diagram` (WebMCP) gave the new diagram the agent's title before checking privacy: with New diagrams are private on, an agent wrote into a Private diagram; on a slow open it renamed the previous one | It checks first, writes only into the diagram it opened and only while AI may change it, and never falls back to the previous editor (`newDiagram.ts`)                                                                  | unit: newDiagram.test.ts                                                                         |
| 8   | Medium (latent) | Without `clone()`, on-device requests ran in the page's one primed session, so a Private diagram's prompt stayed in context for later requests on any diagram                                              | The primed session is dropped after such a request (`useOnDeviceRequest.ts`)                                                                                                                                            | e2e: ai-ondevice "without clone()"                                                               |
| 9   | Low             | Ctrl+K's recent commands kept a Private diagram's node and simulation ids (its words), after the diagram was gone                                                                                          | Not remembered for private diagrams (`recent.ts` `rememberable`)                                                                                                                                                        | unit: rank.test.ts; e2e: privacy-audit "Ctrl+K never remembers"                                  |
| 10  | Low             | Copy Mermaid and draw.io on a Private diagram suggested pasting into mermaid.live, GitHub, Notion or app.diagrams.net                                                                                      | The toast says "This diagram is private: keep it where your team controls access."                                                                                                                                      | e2e: privacy-audit "toasts never point at public sites"                                          |
| 11  | Low             | With the Checks card open, image exports captured its markers, and SVGs their tooltips (the findings' words)                                                                                               | Markers are left out of exports (`image.ts`)                                                                                                                                                                            | e2e: privacy-audit "no check markers"                                                            |
| 12  | Low             | Embeds' CSP allowed Google's scripts and frames and every provider endpoint, none of which an embed uses                                                                                                   | Embeds allow this site only (`scripts/security-headers.ts`, `vercel.json`)                                                                                                                                              | unit: securityHeaders.test.ts                                                                    |
| 13  | Low             | `index.html` had no referrer meta: a self-hosted copy served without the headers fell back to the browser's default                                                                                        | `<meta name="referrer" content="strict-origin-when-cross-origin">`                                                                                                                                                      | unit: securityHeaders.test.ts                                                                    |
| 14  | Low             | The old all-in-one library index (written once at migration) kept deleted diagrams' titles and thumbnails                                                                                                  | Delete takes the row out (Undo still lists it from its own record)                                                                                                                                                      | unit: diagramIO.test.ts                                                                          |

## The owner's decisions

Proposals P1 to P10 went to the owner. Decided:

| #   | Proposal                                                                                                                                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | A plain Interactive HTML file holds the whole diagram JSON (properties, notes, check reasons, imported fields), more than the viewer shows | **Accepted as is.** A self-contained file holding the whole diagram is the point of the format; with a password it's all encrypted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2  | Ctrl+C puts a private diagram's nodes on the OS clipboard as readable JSON (clipboard history and sync may keep it)                        | **Accepted as is.** The clipboard holding JSON is expected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3  | Dictation said where audio goes once per browser                                                                                           | **Built.** While the browser's speech service (not the device) listens, a muted line by the mic says "What you say may be sent to Google's speech service." every time, naming the browser's maker (Microsoft in Edge, Apple in Safari, "your browser's" otherwise). The once-per-browser note and its key are gone. Test: `ai-dictation.spec.ts`, `dictation.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                        |
| P4  | The browser records a visited `#d=` link before the app runs                                                                               | **Accepted as is.** History already holds the diagram you're working on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P5  | The host-supplied embed accepts plain `http://` host origins                                                                               | **Decided and built: keep accepting them**, and the docs (`EMBEDDING.md`, `SELF-HOSTING.md`) say to serve host pages over https when possible, since a page on plain http can be tampered with on the network.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P6  | Hidden data in draw.io, Mermaid and SVG exports (properties, simulations, checks as custom attributes; node ids)                           | **Owner: no change.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P7  | Turning a diagram Private keeps its earlier AI conversation                                                                                | **Decided and built.** The "now private" toast offers **Clear conversation** when there is one: one step, with Undo (the AI panel's own pattern). The offer is its own chunk (`src/ai/ui/clearOnPrivate.ts`). Test: privacy-audit "offers to clear its AI conversation".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P8  | Small hardenings                                                                                                                           | **Decided and built**, every item: (1) the editor's unused JSON export (it skipped `"private": true`) and `downloadDiagram` are removed; (2) **Copy example request** asks AI permission again when clicked (`exampleToCopy`); (3) the tools' refusal says "Private diagrams are excluded from AI…" (the development-only local-only examples keep their own note); (4) the Lab exists only in dev and e2e builds, `?view=lab` opens the canvas in production, and the build fails if `LabView` ships (`noTestHooks`); (5) embeds write nothing to storage (they still read the saved theme). Tests: `exampleRequest.test.ts`, `refusal.test.ts`, `actions.test.ts`, `subpath.spec.ts`, `self-host-locked.spec.ts`, privacy-audit "an embed … writes nothing". |
| P9  | A password link's fragment copied into later history entries                                                                               | **Accepted:** not built (the visit already recorded it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P10 | The skill's committed viewer still retitled an unlocked file                                                                               | **Built:** `pnpm skill:release`, plugin 1.1.1 → 1.1.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Code review of the first commit

A Codex review (seven angles) of the first commit found 9 P1 and 3 P2, in three groups. All were real; all are fixed.

- **Clear everything could wipe after Cancel, or never** (P1 ×2, P2 ×2): confirming awaited a second download, so
  Cancel, Esc or Close during it still wiped everything, and a failed download left the button disabled with no word.
  Now the wipe's code comes with the dialog's own chunk (whose loading frame already has Esc, Close and Retry), and
  confirming clears at once: nothing is pending, so nothing can be cancelled too late or fail silently. Test:
  privacy-audit "Cancel and Esc keep everything".
- **Another tab could write a diagram back mid-wipe** (P1 ×3, P2 ×1): the first version deleted first and told the
  other tabs after, so a late write in another tab survived its reload, and a reload kept each tab's sessionStorage.
  Its replacement (other tabs sweeping storage themselves) was itself wrong; see the second review.
- **The Google warm-up checked privacy only before loading** (P1 ×4): the File menu's warm-up asks again, of the
  diagram open then, once the provider's code has loaded. Test: the provider's code held mid-load while the diagram
  turns private. What can't be undone: once Google's scripts have been put in the page they run, so a diagram made
  private after that point shares the page with them until reload.

## Second code review

A second Codex review (of the fixes above) found 7 P1 and 6 P2. All were real; all are fixed.

- **Other tabs sweeping shared storage** (P1 ×5): a tab that heard of the wipe late (a throttled background tab, or
  one still downloading the cleanup code) swept every app key, so it could delete work the person made after the wipe.
  At full storage the signal itself (a new key) could fail before anything was freed, and a tab whose cleanup download
  failed reloaded without cleaning up. Replaced by the design below: only the confirming tab deletes, nothing in the
  other tabs needs a download, and the signal is written after the deletion has freed space. Tests: a late tab
  (it misses both signals) after new work was made, which survives; full storage; a tab that can't download any more
  of the app's code; Cancel and Esc.
- **The provider race test only matched a build's chunk name** (P1): it now holds `testProvider` on the dev server
  too, asserts the request was held before the diagram turns private, and waits for an explicit signal that the
  provider's code has run (whatever awaited it, the warm-up decision, has then run too), not for a timer.
- **The speech-service line wasn't announced** (P2): it's a polite live region (`role="status"`), mounted with the mic
  and filled when the service starts listening, so a screen reader hears it once per session.
- **Connect to › and Reconnect › kept a private diagram's node ids in Ctrl+K's recents** (P2 ×2): recency is now
  explicit. A menu item or command whose id carries the diagram's ids is marked `documentScoped` where it's made
  (nodes, simulations, Connect to, Reconnect), the palette carries the mark through, and recents skip marked ones for a
  private diagram. Test: every command built from the real actions whose id names a node is marked.
- **Clear conversation looked only in storage** (P2): it asks the conversation store, so a conversation kept only in
  memory (storage full) is offered too.
- **The on-device test proved only that sessions were created** (P2): the fake model records which session took each
  prompt and refuses destroyed ones; the test covers a success, a failure (its retry shares its request's session), a
  cancel, and another diagram in the same page, each in a session of its own, the earlier ones destroyed.

## Third code review

A third Codex review found 1 P1 and 5 P2. The P2s were real and are fixed; the P1 is the limit already written down
below, and stays a limit, by the owner's rule that work made after a wipe is never lost.

- **A write already past its check when the wipe lands can survive it** (P1). Another tab checks the generation, the
  wipe deletes and writes the new one, then that tab's write lands. The candidate fix, one more sweep by the confirming
  tab after writing the generation, can't be made safe: the late write arrives from another tab after a delay the page
  can't bound, so the sweep would have to wait, and while it waits a tab that has already reloaded into the new
  generation can write new work to the same keys (settings, an example's edits) with nothing to tell the two apart.
  The only airtight fix is a generation stamped on every stored record (and every reader ignoring stale ones), which
  is a format change across the whole app. It stays a documented limit; it needs another tab of the app open, writing
  (an autosave a moment after an edit, an AI turn) in the few milliseconds between its own check and the wipe.
- **The legacy index could get a deleted title back** (P2): two tabs deleting at once each rewrote a filtered copy of
  the old all-in-one index, and the later write restored what the earlier one removed. A delete now retires that index:
  rows listed only there get their own records (never a deleted diagram's), then the index is written empty, and
  every tab writes the same empty index. Test: a second tab's delete landing in the middle of the first's.
- **Exported HTML viewers would have reloaded with the app** (P2): importing the storage module registered the wipe
  listeners. The app now joins the lifecycle explicitly (`startStorageLifecycle`, in `main.tsx`); the viewer never does.
- **The delayed Clear conversation offer could land on the wrong diagram** (P2): the offer loads later, so it now goes
  ahead only while the same toast is showing, for the same diagram, still private.
- **`new_diagram` could claim a diagram opened while its title landed** (P2): it checks the document is the same one
  after the title settles (a draft promoted to an entry keeps its identity), and reports that nothing opened otherwise.
- **The full-storage test could fail to fill storage** (P2): it grows one fixed key to the last character and probes
  with that same key, and a test runs it over several amounts already stored.

## How Clear everything works

1. The confirming tab stops its own writers (its autosave on the way out included), deletes every app key from
   localStorage (which frees the space the next step needs), writes a new random **storage generation**
   (`diagrams.generation`), posts it on a BroadcastChannel too, drops its own sessionStorage keys and reloads.
2. Every tab remembers the generation it loaded with, and checks it before each write to localStorage. A tab that
   hears of the new one (the BroadcastChannel, or the storage event from the generation write) or finds it at its next
   write stops writing, drops its own sessionStorage keys and reloads. It never deletes shared storage, so nothing made
   after the wipe can be lost, and that path is startup code: nothing to download.
3. One limit: a write from another tab that passed its check just before the wipe (or read a generation its copy of
   storage hadn't updated yet, a few milliseconds behind) can land after it and survive. Closing it entirely would mean
   stamping every stored record with its generation; a later sweep can't tell such a write from new work (see the third
   review). It needs another tab of the app writing in those milliseconds.

## Not issues (checked)

- No telemetry, analytics, beacons, error reporting, service worker, CDN fonts or third-party scripts by default.
- OAuth tokens live in memory only; sign-in is a PKCE pop-up; `auth.js` stores nothing.
- Host-supplied embeds: origin lock both ways, never `postMessage(…, "*")`, bounded sizes and rates.
- Every link (share, password, embed code, `get_share_link`) asks `canShareAsLink` and asks again at the moment it acts.
- Interactive HTML: zero requests, no storage, no links out, `no-referrer`; a locked file shows nothing in the clear.
- Thumbnails carry no text.
- Private survives every round trip: copies, duplicates, pastes, `.diagram.json`, draw.io and Mermaid.
