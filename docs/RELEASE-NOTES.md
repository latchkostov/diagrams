# Release notes

Changes to habits people already have. The app has no "what's new" panel, so they're noted here.

## Ids: one per element, so edits never hit the wrong thing (2026-10)

No habit changes. A fix for files that give two elements one id, usually a node and a connection (hand- or
agent-written files, some imports):

- **Opening such a file renames the later one** ("billing-db" becomes "billing-db-2"; nodes keep theirs), and the
  import toast says so. Nothing is dropped: two nodes, two boundaries or a note with a node's id used to stop the
  file opening or lose the second one; both are kept now. A boundary's members follow it, and an ignored finding
  stays ignored for each.
- **Edits act on the kind they name.** Removing or updating a connection through the AI panel, an agent
  (`edit_diagram`) or a Checks fix never removes or changes a node, and new nodes, connections, boundaries and notes
  never take an id something else has (pasting and duplicating too).
- **Checks offer their fixes again** on those connections: they were held back while an id could name a node too.

## Checks: four more (2026-10)

No habit changes: the count under the title still shows warnings only, and a diagram that was clean before stays
clean unless it has one of these. New, in the **Checks card**:

- **{n} requests deep** (a warning): requests that go from service to service four or more times in a row. Each one
  must be up for the first to answer. The fix makes the last call a message.
- **{service} uses {owner}'s database** (a warning): a service reaching into a database that a boundary's own service
  uses. The fix, **Ask {owner} instead**, replaces that connection with a request to the owner, label kept. When
  several services in the boundary share the database, it's a suggestion, with no fix.
- **{client} calls {service} directly** (a suggestion): an outside client going around the way in the diagram draws
  (a gateway or load balancer the other clients use). The fix goes through it; chips under the button add a new
  gateway instead (API Management or Front Door on Azure, API Gateway on AWS, Cloud Load Balancing on Google Cloud,
  else a firewall or Kong). Each is offered only when it keeps every connection's traffic as it was; when the direct
  connections carry settings (a filter, a message type, timing), the row says so and has no fix. Diagrams that leave
  ingress out entirely aren't flagged.
- **Every request goes through one {node}**: a service or gateway you run with one replica that is the only way
  through for an entry point. A suggestion when the diagram says `replicas: 1`; a warning when it's 80% busy or more
  at the diagram's own rates. The fix sets replicas. A replica count you never set isn't read as one (unless it's
  busy).
- Agents' `check_diagram` reports them too, with their fixes as edit operations.

## Sharing says who can open it (2026-10)

Two small habit changes:

- In the File menu, the arrow keys now **stop on rows that are off** (a Private diagram's link rows), so the keyboard
  and screen readers hear why they're off. Enter on one does nothing.
- When a link is refused for a Private diagram, the message's button is **Interactive HTML…** (it used to export the
  diagram file).

New:

- **Every way a diagram leaves the app says who can open it**: Copy share link ("Anyone with the link can open it",
  in the menu and its toast), Copy link with password… ("Only people with the password can open it"), and **Embed
  code… ▸ In the link** ("Anyone who can see the page can open this diagram"). Interactive HTML and the private embed
  already did.
- A Private diagram's off rows, the Privacy submenu and the Private dialog name the way to share it: **Interactive
  HTML** (or the diagram file). The reason under an off row stays readable in both themes.
- The Embed dialog is titled **Embed code**, like its menu row, and Esc closes the Share link and Embed dialogs as soon
  as they open. In the embed preview, Esc goes back to the dialog (the next Esc closes it).
- A password link whose password is still being checked never opens over a diagram you moved to meanwhile.
- The Agent Skill mentions **File > Copy link with password…** for a link only some people can open.

## Import Terraform plans and state (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read the JSON from **`terraform show -json`**, a plan or a state, several files
  at once. Queues, topics, functions, databases, secrets and identities on AWS, Azure and Google Cloud get their
  stencils; modules (or Azure resource groups) become boundaries.
- Subscriptions, event-source mappings, EventBridge targets, Service Bus and Event Grid subscriptions and Pub/Sub
  subscriptions become **message flows**, so SNS → SQS → Lambda reads as it runs. References between resources
  become **Identity**, **Secret**, **Config** or **Depends on**, and IAM policies and Azure role assignments say who
  reads which secret and who sends or receives.
- The Import report lists what wasn't drawn by type (policies, networking, helpers), the plan's changes, and
  **Draw everything**, which opens the same files with every resource as a node.
- Sensitive values, variables and outputs are never read. A `.tf` file says to run `terraform show -json plan.out`
  and import that.

## Private embeds: your app supplies the diagram (2026-10)

Nothing you do today changes: embed codes made before work as they did. New:

- **Embed code…** has a third source, **Your app supplies it (private)**. Your page loads a small script from
  livediagrams.dev and fetches the diagram from your own server, behind your own sign-in, then hands it to the
  viewer. The diagram never leaves your app: it isn't in any URL and never reaches livediagrams.dev, which only
  provides the viewer.
- Two ways in, both copied from the dialog: the `<live-diagram>` web component
  (`<live-diagram src-json="/diagrams/orders.diagram.json" simulation="black-friday" autoplay>`), or a plain iframe
  with a few lines of `postMessage`. **Diagram file** in the dialog saves the file to serve.
- Your page can drive it (play, pause, speed, simulation, fit, theme, highlight nodes, load another diagram) and hear
  from it (node clicks, play state, the height that fits the diagram). The reference is `docs/EMBEDDING.md`.
- **Private diagrams can now be embedded this way.** Embed code… used to be off for them; it now opens with only
  this source, since nothing of the diagram goes in the code. Share links and link embeds stay off for them.

## Agent Skill: asks what you want back, and makes Interactive HTML (2026-10)

One habit changes for people who use the livediagrams Agent Skill: it **asks which output you want** before it hands
the diagram back, unless you already said. Update the plugin in Claude Code (`/plugin`), or download the skill again
for the Claude apps and Codex.

- **Interactive HTML file**, offered first and recommended for anything about your work or company: the same file as
  **File ▸ Export as ▸ Interactive HTML…**, made on your computer by the skill (`scripts/export-html.mjs`). It plays
  the simulations, works offline and makes no network requests, and only people who have the file can open it. Ask
  for a banner such as "Confidential".
- **Diagram file** (`.diagram.json`) to keep editing, **Image** (the skill says how to export one from the app) and
  **Share link**, which the skill now says anyone who has it can open. A private diagram never gets a link.
- For work diagrams the skill marks the diagram private (`"private": true`).

## Import Kubernetes manifests (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read **Kubernetes** manifests, several files and documents at once
  (`kubectl get … -o yaml` or `-o json` too). Namespaces become boundaries, workloads get stencils from their
  images, Services lead to the workloads they select, and an Ingress, a Gateway or a LoadBalancer Service is the
  entry from Users.
- ConfigMaps and Secrets become **Config** and **Secret** relationships named by their keys. A Secret's values are
  never read. Workload identity (Azure, AWS IRSA, GKE) becomes an **Identity** relationship.
- Connections come from settings as in docker-compose, and from **KEDA** triggers (Kafka, RabbitMQ, SQS, Service
  Bus): the topic or queue sends to the workload it scales. **Strimzi** topics join with them on their cluster.
- The Import report lists what wasn't drawn by kind ("ServiceMonitor orders-api: unknown kind") and each scaler's
  replica range. A Helm chart's templates say to run `helm template` and import its output.
- New stencil: **Service Account** (Google Cloud).

## Checks (2026-10)

No habit changes. New:

- **Checks** find likely design problems as you edit: failed messages that are dropped (no dead-letter queue), a topic
  or queue nobody reads, requests that go round in a circle, and a service that can't keep up at the diagram's own
  rates. When there's a warning, a muted **⚠ 1 warning** appears under the diagram's title; suggestions alone show
  nothing.
- **Check diagram** (that count, the canvas right-click, Ctrl+K or View ▸ Checks) opens the **Checks card**. Each
  finding names what it involves (click to select it), says why it matters, and offers a fix ("Add dead-letter
  queue") as one undo step. **⋯ ▸ Ignore here** (with an optional reason) and **Turn off this check** are kept in the
  file, so whoever opens it sees the same; the card's foot brings them back.
- While the card is open, small markers show on the nodes and connections it names. Select one and its finding is at
  the top of the inspector.
- Checks run in the background after you pause, so typing and dragging don't wait. Live view and presenting show no
  count; private diagrams are checked like any other, on this device.

## Interactive HTML export (2026-10)

Nothing you do today changes. New:

- **File ▸ Export as ▸ Interactive HTML…** (also the canvas right-click's Export ▸ and Ctrl+K) downloads one
  `.html` file with the diagram and its simulations. Open it in any browser, or put it where your team already
  controls access (SharePoint, Confluence, an internal site, a repository): no public link, no account, no internet.
- In the file, people pan, zoom and play the simulations (pick one, pause, change the speed, trace a message, slow
  motion). They can't edit it, and it opens nothing else: it makes no network requests and saves nothing in the
  browser.
- **Options** sets the title, a banner across the top (say "Confidential: internal use only"), light or dark, which
  simulations go in and which one plays when the file opens.
- Private diagrams can be exported this way too, like saving them to this device. Anyone who has the file can open
  it, and the dialog says so.

## Import AsyncAPI documents (2026-10)

No habit changes. New:

- **Open…**, a drop and **Paste text** read **AsyncAPI** 2.x and 3.x documents. Open several at once and they join
  into one system on their channels: a producer in one file and a consumer in another become one flow. Servers
  become boundaries, channels get their broker's stencil (Kafka, RabbitMQ, Service Bus, SNS, SQS, Pub/Sub, MQTT…),
  and edges carry the message types.
- Each import saves an **Imported traffic** simulation: Go live and pick it to watch the messages flow. The Import
  report says where the traffic starts and how fast.
- References (`$ref`) are followed inside the files you open; a remote one is never fetched, and the report lists it.
- New stencil: **MQTT Broker** (also for Mosquitto, EMQX and HiveMQ in docker-compose files).

## Import docker-compose files (2026-10)

One habit changes: **Open…** and a drop take several files at once. Opening one file works as before. New:

- **Open…**, a drop and **Import from ▸ Paste text…** read a **docker-compose** file. Drop it with its
  `docker-compose.override.yml` (and a `.env` file it names) to merge them the way Compose does. Each import
  makes a new diagram in Your diagrams: services on their stencils (PostgreSQL, Kafka, NGINX…), the networks
  as boundaries, and connections found in the files, including settings such as `DATABASE_URL` or `INPUT_TOPIC`.
- The toast's **Details** opens the **Import report**: which stencils are guesses (one click picks another),
  which setting each connection came from, and what wasn't drawn or couldn't be read, and why. Ctrl+K "Import
  report" opens it again while the diagram is open.
- Everything is read on this device. Setting values are used only to find host names and are never kept. With
  **New diagrams are private** on, the import is private; otherwise the report offers **Make it private**.
- Kubernetes manifests, AsyncAPI documents and Terraform plans are recognised, and say they can't be imported
  yet.
- New stencil: **MySQL** (MariaDB too).

## UX review, round 13 (2026-10)

Two habits change:

- **Double-click quick-add opens the new node's name.** Pick a stencil and type: the words name the node, as after
  Alt+arrow, the "+" and a dropped connection. They used to reach the canvas, where a T added a text and an L went
  live. One Ctrl+Z takes the node, its connection and their names, however long you take to type them (also after
  Alt+arrow, the "+", a dropped connection, or a rail or Ctrl+K add named with Enter straight after).
- **Shift+drag on empty canvas adds to the selection**, as Shift+click does. A plain drag still replaces it.

Also:

- An Undo toast ("Payments service left AKS · Undo") goes as soon as Ctrl+Z or the canvas's Undo runs, since its
  button would then reverse a different change.
- Esc clears the selection and keeps keyboard focus on the node, so Tab carries on from there; Esc never selects.
- Ctrl+K finds **Present**. Presenting puts keyboard focus on the canvas.
- In the AI panel, Advanced and the on-device box no longer squeeze the conversation: past 60% of the panel, they
  scroll.
- The shortcuts sheet lists the File keys (Ctrl+O, Ctrl+S, Ctrl+Shift+S) and slow motion's ← →.

## Private diagrams (2026-10)

No habit changes unless you use it. New:

- **File ▸ Privacy ▸ Private diagram** keeps a diagram on this device: no share links or embed codes, no saves to
  Google Drive, OneDrive or Dropbox, and no AI (the page's tools, Copy for AI and copied prompts are off). A
  **Private** lock sits beside its title; click it to read what that means or to make it not private again.
  Saving and exporting to this device work as before, and an exported file stays private when it's opened again.
- **File ▸ Privacy ▸ New diagrams are private** makes everything you start, import or open from this device
  private.
- In a private diagram the AI panel can allow Chrome's on-device model, which runs on this device.

## Structure and bulk (2026-10)

Three habits change:

- **Boundaries keep up.** A node belongs to the boundary around its centre, as before, but you now see it while you
  drag: the boundary it will be in lights up, and one it's leaving shows dashed. Drop a member so it pokes out of
  its boundary and the boundary grows to hold it; it used to stay the same size, and a node dragged a little too
  far quietly left. Leaving now says so, with Undo. Resizing a boundary takes in the nodes now inside it and lets
  go of those outside. Boundaries never shrink by themselves: Fit to contents does that.
- **Tab moves between nodes.** The canvas is one stop in the page's Tab order. Inside it, Tab and Shift+Tab step
  through the nodes in reading order, selecting each one; past the last, Tab leaves the canvas. Tab used to visit
  every node and then every edge, in the order they were made. Edges are reached from a node with Ctrl+Alt+] and
  Ctrl+Alt+[, and Ctrl+Alt+arrows (⌃⌥ on a Mac) go to the nearest node that way.
- **Route from side and Route to side are one row**, Route ▸, on the edge's menu.

Also new:

- With several things selected, the inspector edits them together: the nodes' stencil, boundary and shared
  simulation settings, the edges' relationship and label, and the colour of annotations and boundaries. "Mixed"
  shows where they differ. Each change is one undo step.
- Select similar (a node's or an edge's right-click, Ctrl+K) selects every node of that stencil, or every edge of
  that relationship.
- Tidy up (a selection's right-click, the inspector, Ctrl+K) lays out just the selected nodes by their connections,
  without moving anything else. Align and Distribute no longer stack nodes on top of each other.

## Flow building (2026-10)

One habit changes:

- **A rail click respects the selection.** With exactly one node selected, clicking a stencil in the rail adds
  it after that node, connected, as Ctrl+K's "Add …" already did. The rail's footer says so ("A click adds
  after Payments service"). With nothing selected, or several things, it adds an unconnected node in free
  space, as before. Drag the stencil instead to place it anywhere.

Also new:

- A selected node shows a "+": click it to pick the next node, which lands beside it, connected and ready to
  name. Alt+arrow does the same from the keyboard (→ and ↓ downstream, ← and ↑ upstream), and Alt+Shift+arrow
  adds a copy of the node there. On the canvas, Alt+← and Alt+→ no longer go back or forward in the browser.
- A new connected node's name editor has one more field: Tab, Tab names its connection.
- Drag either end of a selected edge onto another node to rewire it; it keeps its label and settings. From the
  keyboard, the edge's menu and Ctrl+K have Reconnect ▸ From / To.
- Hold a new node (or a stencil from the rail) over an edge for a moment and drop it to put it in between, or
  use Insert node on the edge's menu or in Ctrl+K.
- Dragging a stencil shows the node card it makes and an outline where it will land.
- Quick-add finds stencils the way the rail does: "pg" finds PostgreSQL, "go" the Go service.

## Drawing precision (2026-10)

Two habits change:

- **Esc saves a label instead of cancelling it.** In a node's label editor Esc used to throw the edit away; now
  it keeps it, as it already did for text and notes, and as Figma and tldraw do. Every text box on the canvas
  works the same way: Enter or Esc saves, Tab goes to the next field (label, then subtitle). Changed your mind?
  Ctrl+Z (⌘Z on a Mac) right after takes the edit back.
- **Snap to grid is now Snapping, and the arrow keys stay on the grid.** Dragged nodes line up with their
  neighbours' edges and centres, and with equal gaps, as well as with the grid. Hold Ctrl (⌘ on a Mac) while
  dragging to place something freely. An arrow key moves the selection to the next 10 px grid line and
  Shift+arrow moves it 50 px; they used to move 1 px and 10 px, which they still do with Snapping turned off
  (Show ▸ Snapping).

Also new:

- Enter edits the selected node, edge, boundary or annotation (F2 still works).
- Label editors stay readable when you're zoomed out.
- Ctrl+K opens at once, and what you type straight after it goes into its search.

## Drawing basics (2026-10)

Two habits change, to work like Figma, tldraw, Excalidraw and draw.io:

- **The wheel pans; Ctrl/⌘+wheel zooms.** A two-finger swipe moves the canvas in both directions, a pinch
  zooms, and Shift+wheel pans sideways on a mouse. Mouse users who zoomed with the wheel now hold Ctrl (⌘ on a
  Mac). Space+drag and the middle button pan from anywhere, even starting on a node.
- **A drag on empty canvas draws a selection box** (it picks what it touches; hold Ctrl/⌘ for only what's
  inside). Shift+click now adds to the selection, like Ctrl/⌘+click. Live view, presentation and embeds still
  pan with a drag, and an embed still lets the wheel scroll its page.

Also new:

- Drop a connection on empty canvas to pick the next node: it lands there, connected, ready to name.
- A connection dropped anywhere on a node connects to it; the node lights up first, and handles are easy to
  hit at any zoom.
- Ctrl+D, Ctrl+V and Alt+drag never put a copy on top of anything. Ctrl+V pastes at the pointer.
- Shift+2 zooms to the selection (also in Ctrl+K).
