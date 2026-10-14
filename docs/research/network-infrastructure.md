# On-prem and data-centre network infrastructure

Research and plan, October 2026. Batch 1 is built (see "Batches"). The owner's request:

> There really aren't things like routers and switches, and firewalls of the typical nature: not a
> software-as-a-service, but something you'd have in your own rack, like a Cisco 3825, or whatever other routers
> would be branch-sized or data-centre-sized. Add different infrastructure components, like all of the major brands:
> Cisco, Juniper, Palo Alto, BIG-IP… the majority of them people would want to use, so we can have different settings
> for each stencil, and have that simulation-capable as well.

## Summary

- **What to add.** Four device types: routers, switches, firewalls (NGFWs) and application delivery controllers
  (ADCs). Each gets a generic stencil and the vendor families people actually draw. That is 19 stencils from nine
  vendors: Cisco, Juniper, Arista, HPE Aruba, Palo Alto Networks, Fortinet, Check Point, F5 and NetScaler. They live
  in a new **On-prem network** category and a new **Network vendors** family filter.
- **Granularity.** One stencil per vendor family, not per model. Each family has **size presets** (branch, campus,
  data centre) whose throughput and latency come from a named model's datasheet. Every preset is cited, marked
  approximate and editable per node. A model SKU is a subtitle ("PA-3440 · active-standby"), and search finds old
  model numbers ("3825" finds Cisco ISR).
- **Icons.** Device glyphs, not vendor logos: a router, a switch, a firewall and an ADC. The vendor is the
  stencil's brand: its name, its accent colour and the subtitle. No vendor icon library grants redistribution, and
  Simple Icons lacks four of the nine brands (see "Icons and trademarks").
- **Simulation.** A device is a **gateway** (a pass-through hop) with a **throughput ceiling**. The ceiling is
  datasheet Gbps converted to messages per second at an assumed message size (64 kB, editable). HA pairs and clusters
  are units: active-active adds them up, and active-standby carries one. When an active-standby pair loses a unit it
  **fails over**: traffic waits a few seconds, and nothing is lost. A firewall's connection can be a **deny rule**:
  what's routed there is **blocked**, counted apart from failures and drops. ADCs spread their traffic and
  **health-check** their targets. Existing gateways (nginx, HAProxy, Load Balancer, Firewall / WAF) behave exactly as
  before.
- **Checks.** A device is a box you run. The single-point check offers **Make it an HA pair**, can't-keep-up reads the
  device's ceiling and offers the next size, and a deny rule is never a loss, Run simulations included.

## 1. Vendors and families people diagram

### Market share and analyst coverage

| Segment                  | What the analysts say (latest available)                                                                                                                                                                                                                                     | Sources                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Ethernet switches        | IDC 2Q26: Cisco 28.7%, Arista 13.4%, Huawei 8.2%, HPE 6.1% (with Juniper, acquired July 2025) of $18.9B. 1Q26: Cisco 29.3%, Arista 14.6%.                                                                                                                                    | [IDC 2Q26][idc-2q26], [IDC 1Q26][idc-1q26]                      |
| Routers                  | IDC 2Q26: Cisco 34.7%, Huawei 29.9%, HPE 10.7% of $4.5B.                                                                                                                                                                                                                     | [IDC 2Q26][idc-2q26]                                            |
| Campus switching         | Dell'Oro 3Q25: with Juniper, HPE is "neck-and-neck" with Huawei for second, behind Cisco.                                                                                                                                                                                    | [Dell'Oro][delloro-campus]                                      |
| Data-centre switching    | IDC 2Q26: NVIDIA 20.4%, Arista 18.7%, Cisco 18.2% of $12.3B. Dell'Oro (AI back-end, 2Q26): Celestica, NVIDIA, Arista, Cisco.                                                                                                                                                 | [IDC 2Q26][idc-2q26], [Dell'Oro][delloro-ai]                    |
| Firewalls                | Gartner MQ for Hybrid Mesh Firewall (September 2026): Leaders Palo Alto Networks, Fortinet, Check Point; Cisco, Forcepoint, HPE (Juniper), Sophos, SonicWall and others evaluated. IDC security appliances 4Q24: Fortinet 18.95%, Palo Alto 18.71%, Cisco 11.44% of revenue. | [Gartner][gartner-hmf], [Fortinet][ft-hmf], [IDC 4Q24][idc-sec] |
| Wired and wireless LAN   | Gartner MQ 2026 (May): Leaders HPE (Aruba and Juniper Mist), Cisco, Arista, Huawei; Extreme a Visionary. 2025: Juniper, HPE Aruba, Huawei, Fortinet.                                                                                                                         | [Arista][arista-mq], [Cisco][cisco-mq], [Juniper][juniper-mq]   |
| ADCs / load balancers    | Dell'Oro 2025: F5 42% of the ADC market; second NetScaler, third A10.                                                                                                                                                                                                        | [Dell'Oro award][delloro-adc]                                   |
| SD-WAN                   | Gartner MQ (latest verified, September 2024): Leaders Fortinet, Palo Alto (Prisma SD-WAN), HPE Aruba (EdgeConnect), Versa. VeloCloud moved from Broadcom to Arista in July 2025.                                                                                             | [Fortinet][ft-sdwan], [The Register][velocloud]                 |
| SSE / SASE               | SSE MQ (July 2026): Zscaler, Netskope, Palo Alto. SASE platforms (July 2026): Netskope, Cato, Palo Alto, Zscaler. Cloud services: out of scope here.                                                                                                                         | [Netskope][sse], [SDxCentral][sase]                             |
| DNS, DHCP and IPAM (DDI) | Infoblox is the recognised leader (its last analyst share, IDC 2015, was 49.9%); EfficientIP and BlueCat follow.                                                                                                                                                             | [Infoblox][infoblox], [EfficientIP][eip]                        |

### Recommended set

The set that covers most enterprise and data-centre diagrams, by device type:

| Type     | Families (batch 1)                                                                                                                         | Why these                                                                                   | Later                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Router   | Generic; **Cisco ISR / Catalyst 8000 edge** (the 3825's line); **Juniper MX**                                                              | Cisco has a third of routers; MX is the enterprise and SP edge standard                     | Cisco ASR 1000, MikroTik CCR, Meraki MX  |
| Switch   | Generic; **Cisco Catalyst**; **Cisco Nexus**; **Arista**; **Juniper EX**; **Juniper QFX**; **HPE Aruba CX**                                | Cisco, Arista and HPE (with Juniper) are most of enterprise and DC switching                | Extreme, Dell, Ubiquiti, NVIDIA Spectrum |
| Firewall | Generic NGFW; **Palo Alto PA-Series**; **FortiGate**; **Cisco Secure Firewall (Firepower, ASA)**; **Check Point Quantum**; **Juniper SRX** | The three Gartner leaders, plus Cisco (third by revenue) and SRX (Juniper's branch routing) | Sophos XGS, SonicWall, WatchGuard        |
| ADC      | Generic ADC; **F5 BIG-IP**; **NetScaler**                                                                                                  | F5 has 42% of the market, NetScaler is second                                               | A10 Thunder, Progress Kemp LoadMaster    |

Out of scope for batch 1: wireless (controllers and access points: no message flow worth simulating), cloud SSE and
SASE (Zscaler and the like are SaaS: the existing generic CDN, Firewall / WAF and external API stencils draw them),
and DDI appliances (DNS already has a stencil).

## 2. Granularity

Three options:

- **Generic device types only** (router, switch, firewall). Simple, but the owner asked for the brands, and a vendor's
  family changes the numbers by an order of magnitude.
- **Vendor + family** (Palo Alto PA-Series, FortiGate, BIG-IP). **Chosen.** It's how people talk ("the Palos", "the
  F5s") and how vendors sell. A family spans branch to data centre, which the size presets cover.
- **Specific models** (PA-3440, C8200-1N-4T, Cisco 3825). Too many to keep current (each family has five to fifteen
  models, renamed every few years: the 3825 was announced in 2004 and has been unsupported since 2016
  ([Cisco][cisco-3825], [EOL7247][cisco-3825-eol]). A model is better as data: the preset names its model, the
  subtitle can name yours, and search finds model numbers through aliases ("3825", "4331", "c8300", "pa-440",
  "mx204", "qfx5120"), so nobody needs to know which stencil the line moved to.

### Size presets

Each family has a size preset per tier it's sold for: **branch**, **campus** and **data centre**. Families made only
for data centres (Nexus, QFX, MX) have no branch size. A preset names its datasheet model and gives:

- **Throughput per unit, in Gbps**, with the vendor's own test condition:
  - **Routers:** IPsec with 1,400-byte packets. Most WAN links are encrypted, and forwarding without services
    overstates them.
  - **Switches:** switching capacity in both directions (all ports together).
  - **Firewalls:** threat prevention (or protection), what an NGFW delivers with its inspection on.
  - **ADCs:** L7 throughput.
- **Latency:**
  - **Routers:** about 50 µs ([Tolly][tolly]).
  - **Switches:** the datasheet's port-to-port figure, or a few µs where none is published.
  - **NGFWs:** half a millisecond per inspected HTTP transaction ([SE Labs][selabs], which measured 0.56 to 1.68 ms at
    half load on a Cisco 4225).
  - **ADCs:** 0.2 ms. This is an assumption: no vendor publishes one.

Vendors measure differently, so presets aren't comparable across vendors. A FortiGate's "threat protection" isn't a
Palo Alto's "threat prevention". The inspector says "approximate" and names the model, and every number can be
changed.

| Stencil                           | Branch                              | Campus                             | Data centre                           | Condition                         | Sources                                                       |
| --------------------------------- | ----------------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| Cisco ISR                         | Catalyst 8200-1N-4T, 1 Gbps         | Catalyst 8300-2N2S-4T2X, 18.9 Gbps | Catalyst 8500-12X4QC, 135 Gbps        | IPsec, 1,400 B                    | [C8200][c8200], [C8300][c8300], [C8500][c8500]                |
| Juniper MX                        | none                                | MX204, 400 Gbps                    | MX304, 4.8 Tbps                       | System throughput                 | [MX204][mx204], [MX304][mx304]                                |
| Cisco Catalyst                    | 9200-48P, 176 Gbps                  | 9300-48P, 256 Gbps                 | 9500-32C, 6.4 Tbps                    | Switching capacity                | [C9200][c9200], [C9300][c9300], [C9500][c9500]                |
| Cisco Nexus                       | none                                | 93180YC-FX3, 3.6 Tbps              | 9364D-GX2A, 51.2 Tbps                 | Switching capacity                | [FX3][nx-fx3], [GX2][nx-gx2]                                  |
| Arista                            | 720XP-24ZY4, 360 Gbps, 1.2 µs       | 720XP-48ZC2, 880 Gbps, 1.2 µs      | 7050SX3-48YC8, 4 Tbps, 800 ns         | Full duplex                       | [720XP][a-720xp], [7050X3][a-7050x3]                          |
| Juniper EX                        | EX2300-48P, 176 Gbps                | EX4400-48P, 696 Gbps               | EX4650-48Y, 4 Tbps, 550 ns            | Bidirectional                     | [EX2300][ex2300], [EX4400][ex4400], [EX4650][ex4650]          |
| Juniper QFX                       | none                                | QFX5120-48Y, 4 Tbps, 800 ns        | QFX5240-64OD, 102.4 Tbps              | Bidirectional                     | [QFX5120][qfx5120], [QFX5240][qfx5240]                        |
| HPE Aruba CX                      | CX 6100 48G, 176 Gbps, 1.9 µs       | CX 6300M 48-port, 880 Gbps, 1.5 µs | CX 8360-48Y6C, 4.8 Tbps               | Switching capacity                | [6100][cx6100], [6300M][cx6300], [8360][cx8360]               |
| Palo Alto NGFW                    | PA-440, 1.2 Gbps                    | PA-3440, 20 Gbps                   | PA-5440, 70 Gbps                      | Threat Prevention, appmix         | [PA-400][pa400], [PA-3400][pa3400], [PA-5400][pa5400]         |
| FortiGate                         | 70G, 1.3 Gbps                       | 400F, 9 Gbps                       | 3700F, 75 Gbps                        | Threat Protection, enterprise mix | [70G][fg70g], [400F][fg400f], [3700F][fg3700f]                |
| Cisco Secure Firewall             | 1210, 6 Gbps                        | 3130, 38 Gbps                      | 4245, 140 Gbps                        | FW + AVC + IPS, 1,024 B           | [1200][csf1200], [3100][csf3100], [4200][csf4200]             |
| Check Point Quantum               | Quantum Force 3920, 3.2 Gbps        | Quantum Force 9100, 6.5 Gbps       | Quantum Force 19100, 35 Gbps          | Threat Prevention, enterprise mix | [3920][cp3920], [9100][cp9100], [19100][cp19100]              |
| Juniper SRX                       | SRX345, 295 Mbps                    | SRX2300, 6 Gbps                    | SRX4600, 10.5 Gbps                    | Threat (IPS) throughput           | [SRX300 line][srx300], [SRX2300][srx2300], [SRX4600][srx4600] |
| F5 BIG-IP                         | r2600, 13 Gbps                      | r5900, 95 Gbps                     | r10900, 190 Gbps                      | L7 throughput                     | [rSeries][f5-rseries]                                         |
| NetScaler                         | MPX 9210, 10 Gbps                   | MPX 9230, 30 Gbps                  | MPX 17000Z, up to 350 Gbps            | System throughput                 | [NetScaler][netscaler]                                        |
| Generic router, switch, NGFW, ADC | 1 Gbps; 176 Gbps; 1.2 Gbps; 10 Gbps | 10 Gbps; 880 Gbps; 9 Gbps; 50 Gbps | 100 Gbps; 3.6 Tbps; 70 Gbps; 190 Gbps | Typical of the families above     |                                                               |

Not used, and why:

- **L7 requests/s** (F5 r2600: 475,000) is measured with tiny pages. At 64 kB a message, throughput binds first:
  13 Gbps is about 25,000 messages/s.
- **New connections/s** binds only when every message opens a connection; see TLS in "Later" below.
- **Juniper QFX5130 latency:** the HTML page says 630 ns and the PDF 1,000 ns. QFX5220 and 5230 weren't verified.

## 3. Icons and trademarks

`docs/ICONS.md` admits a source when its licence allows redistribution in this MIT app. Each vendor:

| Source                                            | Terms                                                                                                                                                                                                                                                                                            | Verdict                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Cisco network topology icons][cisco-icons]       | "You may use them freely, but you may not alter them." Cisco's [site terms][cisco-terms] bar distributing its materials without written consent; "all rights not expressly licensed are reserved".                                                                                               | No: no licence to redistribute, and restyling breaks "may not alter" |
| [Juniper icons and Visio stencils][juniper-icons] | Assets "cannot be used to promote or sell any product, service, or technology other than those belonging to Juniper Networks" ([terms][juniper-terms]).                                                                                                                                          | No                                                                   |
| [Fortinet icon library][fortinet-icons]           | All rights reserved; questions to icons@fortinet.com.                                                                                                                                                                                                                                            | No                                                                   |
| [F5 Visio stencils][f5-icons]                     | No licence on the page.                                                                                                                                                                                                                                                                          | No                                                                   |
| Palo Alto Networks, Arista                        | No current icon library published.                                                                                                                                                                                                                                                               | None to use                                                          |
| [Simple Icons][si] (CC0)                          | Has `cisco`, `junipernetworks`, `paloaltonetworks`, `fortinet`, `f5`, `citrix`; lacks Check Point, Arista, HPE / Aruba and NetScaler. Its [disclaimer][si-disclaimer]: CC0 "doesn't mean to imply that all icons within the project are also CC0", and users should seek the brands' permission. | Legal, but uneven: four of nine brands missing                       |

**Chosen: device glyphs.** Network diagrams have always drawn devices by what they do (Cisco's own symbols are a
router's circle with arrows and a switch's box with arrows). A glyph says it's a firewall at a glance, whoever made
it. Three glyphs are drawn for this app in Lucide's style: `net-router`, `net-switch` and `net-adc`. The fourth,
`net-firewall`, is Lucide's `brick-wall-fire`; the existing Firewall / WAF keeps `brick-wall-shield`. The vendor shows
as the stencil's brand: its name ("Palo Alto NGFW", vendor "Palo Alto Networks"), its accent colour on the card, and
the subtitle. Vendor names are used nominatively, as `docs/ICONS.md`'s Trademarks section says. A later batch could
add a small vendor badge from Simple Icons where one exists, if the owner wants logos; the glyph would stay.

## 4. Simulation model

### What exists today

- `generic.firewall` (Firewall / WAF), `load-balancer`, `haproxy` and `nginx` are **gateways**. A message waits the
  latency (default 60 ms) with no limit on how many at once, then goes to one outgoing connection, round-robin, among
  those whose filter accepts its type.
- Capacity analysis gives gateways a single-lane estimate (1,000 / latency), and live view's planning removes even that
  (gateways and stores are unlimited, as in playback), so the heat map never colours a gateway.
- A gateway sends to a target that's down, and the message is dropped there.

### What a network device does

A device stencil is still a **gateway**, so routing, filters, replies, traces and checks work as for any gateway.
What's new:

- **A throughput ceiling.** The ceiling is `gbps × 10⁹ ÷ 8 ÷ (messageKB × 1,000)` messages/s per unit. At the 64 kB
  default, 1 Gbps is 1,953 messages/s: a branch firewall around 2,300/s, a campus one 17,000 to 74,000/s, a
  data-centre switch millions.
  - **Why 64 kB:** an HTTP request with its reply, the size Palo Alto and Juniper used for their throughput tests (Palo
    Alto now uses an appmix; Juniper's NGFW figure still uses 64 KB transactions).
  - **Message size** is a setting: a team sending 2 kB events through a firewall sets 2, and the ceiling rises 32-fold.
  - **In playback,** a device admits at most its ceiling (a token bucket, in sampled dots at the run's scale), and the
    rest waits in its backlog. The rest isn't dropped: queues on real devices are short, but TCP retransmits, so for a
    message (a transaction) waiting is the visible effect.
  - **In analysis,** capacity is the same ceiling, so the heat map and the bottleneck callout colour devices ("1% ·
    440/s of 39k/s").
- **HA: units.** `replicas` are a device's units, and `ha` says how they work:
  - **Standalone** (the default): one box.
  - **Active-standby pair:** one unit carries traffic, so capacity doesn't add up; the other is there for failures.
    Choosing it sets two units.
  - **Active-active cluster:** units share the traffic, and their throughput adds up.
- **Failover.** When an active-standby pair loses a unit (a timeline props step, or **Fail the active unit** in live
  view's Behaviour menu) and one is left, the pair **fails over**:
  - **The stall:** for `failoverMs` (default 3 s), traffic waits at the device, then drains. Nothing is dropped.
  - **Why 3 s:** default HA timers put real failovers at seconds. Palo Alto: 1 s heartbeats, three lost, then a 2 s
    promotion hold ([PAN][pan-ha]). Cisco ASA: 15 s by default, 0.8 s at best ([Cisco][asa-ha]). F5: 3 s
    ([community][f5-ha]). FortiGate: about 4 s with defaults ([Fortinet][fgcp]).
  - **What shows:** the badge says **failing over**, and the event log says how many units are left.
  - **Clusters and outages:** an active-active cluster losing a unit has no stall, only less capacity. The whole pair
    down (**Kill**) drops everything sent to it, as any node down does.
- **Deny rules.** A connection's `deny: true` makes it a deny rule. What's routed onto it is **blocked** at the
  source node:
  - **Counting:** a `blocked` counter, a `block` event, and a trace step of its own kind (`block`), so the journey,
    the sequence diagram, slow motion and the trace card all say Blocked. It's never `dropped` or `failed`, so no red
    count, no failure flash, and no "Messages are lost" from Run simulations.
  - **Which traffic:** a gateway routes by type (filters), so a rule with a filter is a rulebase line. "Deny:
    branch → payments" with `filter: ["PaymentAdmin"]` blocks only that type; without a filter, the rule takes its
    round-robin share.
  - **Where it shows:** the inspector offers the rule on connections leaving a firewall (the new ones and Firewall /
    WAF). The engine honours `deny` on any connection and every delivery path (one place blocks them all): a
    gateway's pick, a service's fan-out, a change feed, a broker's delivery, a redelivery and a dead letter.
- **ADCs: spread and health checks.** An ADC round-robins across its targets, like any gateway. With `healthChecks`
  (on by default for ADC stencils, off for every other gateway, so nothing that exists changes), targets that are down
  get nothing while another is up, in playback and in analysis.

### Settings (the inspector)

A device's **Simulation** section, simple by default. Each field's hint says where its default comes from:

1. **Size**: a select, "Campus: PA-3440, 20 Gbps". Picking one clears a throughput or latency typed over the old size.
2. **Throughput** (Gbps). The placeholder is the preset's, and a note under it says "About 39k messages/s per unit at
   64 kB each. From the PA-3440 datasheet: approximate."
3. **High availability**: Standalone, Active-standby pair, Active-active cluster. **Units** shows for a pair or a
   cluster.
4. **Latency** (ms).
5. **Health checks** (ADCs only).
6. **Message size** (kB), and **Failover** (ms) for an active-standby pair, side by side at the end.

A connection leaving a firewall shows **Firewall rule: Allow / Deny** under its relationship. The consumer group and
dead-letter path, which only mean something leaving a broker, step aside. A denied connection is drawn with a "no
entry" glyph just after its source and a muted red line, in the editor, live view and exports alike.

### Backward compatibility

- No stencil changed role, and no existing gateway gained a ceiling or health checks. The new behaviour comes from a
  device stencil, or from props no existing diagram has (`gbps`, `ha`, `deny`, `healthChecks`). The existing unit
  suites (engine, capacity, examples, checks) pass unchanged.
- Any gateway given `gbps` gets the ceiling, so an nginx box can be sized too, from the custom properties.

### Later (not in batch 1)

- **TLS offload.** New TLS handshakes per second (F5 r2600: 7,000 RSA 2K; NetScaler MPX 9210: 45,000) bind when every
  message opens a connection. That would be a second, optional ceiling, "handshakes/s", with a share of messages that
  open one.
- **VPN and SD-WAN tunnels.** A connection's latency is visual travel today (`travelMs`), not modelled delay. A WAN
  link with a bandwidth and a round-trip time would need a real edge model: its own batch.
- **Firewall rule order and default deny.** Today a rule is a connection. A real rulebase is ordered, with a default
  deny for whatever matches nothing.
- **Connections per second and session tables** for firewalls; packet loss under overload.

## 5. Checks

- **single-point.** Network devices are self-hosted gateways, so a device that every request goes through fires when
  the diagram says it's one unit (`ha: "standalone"` or `replicas: 1`), or when it's 80% busy. The fix is **Make it an
  HA pair** (`ha: "active-standby"`, `replicas: 2`). A pair or a cluster never fires.
- **capacity (can't keep up).** Now reads a device's ceiling. A device over 100% at the diagram's own rates is a
  Warning whose fix is the smallest bigger size that brings it under 55% ("Use the campus size (PA-3440)"), or none
  when no size would.
- **Deny rules are on purpose.** A blocked message is never dropped, so neither the dead-letter check nor Run
  simulations calls it lost.
- **sync-chain** counts requests between services only, so routers, firewalls and switches in a path never make a
  chain look deep.

**Precision gate on the new example** (Branch office to data centre, 13 nodes, two saved simulations): every rule,
no findings, and Run simulations counts no loss in either simulation. That's right for the design:

- **In the data centre,** the edge routers and the services leaf are active-active pairs, and the firewall and ADC are
  active-standby pairs, with two spines and two web servers.
- **The one deny rule** blocks on purpose.
- **The branch router** is a single box on the branch's only path. The diagram doesn't say how many units it has, and
  it's 2% busy, so single-point stays quiet: the checks' batch 3 gate made an unset count no evidence. A branch often
  runs one router on purpose.

Checked in `src/checks/examples.test.ts`.

## 6. Imports and agents

- **draw.io (built).** Cisco library shapes (`mxgraph.cisco.routers.*`, `switches.*`, `security.firewall`, ASA, load
  balancers, and cisco19's `prIcon`) read as the generic router, switch, NGFW and ADC. Labels naming a vendor or
  family ("Palo Alto PA-3440", "FortiGate 400F", "Cisco ASA 5525", "F5 BIG-IP LTM", "Cisco 3825", "Nexus", "Arista",
  "core switch", "WAN router") find their stencil through `inferStencil`, as do agents' kind words.
- **Terraform, Kubernetes, docker-compose (not built).** Device providers (`panos_*`, `fortios_*`, `bigip_ltm_*`,
  `junos_*`, `aci_*`) configure policies, VIPs and interfaces, not the box, so one device would come from dozens of
  resources. Mapping them needs grouping by device, which isn't trivial: a later batch. Compose images (haproxy,
  nginx) already map to their stencils.
- **Agents.** `find_stencils` finds the devices ("3825" gives Cisco ISR first) and takes the `onprem` category. The
  file format, ops and skill schemas know the new props (`size`, `gbps`, `messageKB`, `ha`, `failoverMs`,
  `healthChecks`, an edge's `deny`) and the `blocked` metric, regenerated by `pnpm schemas`.

## 7. Batches

**Batch 1 (built):**

- **Stencils and finding them:** 19 stencils in four types and nine vendors, the On-prem network category, the Network
  vendors family, aliases, and four device glyphs.
- **Simulation:** size presets from datasheets; the ceiling in playback and analysis; HA units and failover; deny
  rules and the `blocked` count; ADC health checks.
- **Editing and live view:** the inspector's device section and firewall rule; the deny glyph on the canvas; live
  badges (blocked, failing over, units); live view's Fail the active unit.
- **Checks, imports and agents:** single-point and capacity for devices; the draw.io Cisco shapes and label
  inference; schemas and the skill.
- **The example:** Branch office to data centre, with two saved simulations.

**Batch 2 (proposed):**

- **More families:** Cisco ASR 1000 and Meraki MX, Sophos XGS, SonicWall, A10 Thunder, Progress Kemp, Extreme.
- **TLS offload:** handshakes per second as an optional ceiling on ADCs and firewalls.
- **Interface:** a vendor badge on the glyph from Simple Icons where one exists, if the owner wants logos.

**Batch 3 (proposed):**

- **WAN links:** bandwidth and round-trip time on a connection (VPN, SD-WAN, MPLS), so a branch link can saturate
  and add real latency.
- **Rulebases:** ordered rules and a default deny, in the inspector and the file.

**Batch 4 (proposed):**

- **Wireless and DDI:** controllers, access points, DNS, DHCP and IPAM (Infoblox), as decorative or sink roles.
- **Infrastructure imports:** Terraform's device providers, grouped by device.

## Sources

[idc-2q26]: https://www.idc.com/resource-center/blog/ethernet-switch-market-surges-43-4-to-18-9b-in-2q26-as-ai-infrastructure-demand-drives-record-datacenter-spending/
[idc-1q26]: https://www.idc.com/resource-center/blog/nvidia-becomes-1-in-datacenter-ethernet-switching-as-1q26-market-surges-39-8-to-15-4-billion/
[delloro-campus]: https://www.delloro.com/news/hpe-challenges-huaweis-campus-switch-market-share-with-addition-of-juniper/
[delloro-ai]: https://www.delloro.com/news/ai-back-end-networks-switch-sales-surpass-front-end-networks-for-the-first-time-in-2q2026/
[gartner-hmf]: https://www.gartner.com/en/documents/8350017
[ft-hmf]: https://fortinet.com/resources/analyst-reports/gartner-magic-quadrant-hmf
[idc-sec]: https://my.idc.com/getdoc.jsp?containerId=prUS53243925
[arista-mq]: https://www.arista.com/company/news/press-release/24030-pr-20260520
[cisco-mq]: https://blogs.cisco.com/news/cisco-named-a-leader-in-the-2026-gartner-magic-quadrant-for-enterprise-wired-and-wireless-lan-infrastructure
[juniper-mq]: https://www.juniper.net/us/en/reports/gartner/magic-quadrant-for-enterprise-wired-and-wireless-lan-infrastructure.html
[delloro-adc]: https://cdn.sanity.io/media-libraries/mlg6Zwp8Ejtd/files/containers/3C2GQpFxTGWXlZjRKqzaeqWdPMb/2025-delloro-market-share-leader-award-companion.pdf
[ft-sdwan]: https://www.fortinet.com/blog/business-and-technology/fortinet-named-a-leader-in-gartner-magic-quadrant-for-sd-wan-for-fifth-year
[velocloud]: https://www.theregister.com/2025/07/02/arista_acquires_velocloud_from_broadcom/
[sse]: https://www.globenewswire.com/news-release/2026/08/04/3338602/0/en/netskope-named-a-leader-in-the-gartner-magic-quadrant-for-security-service-edge-for-5th-year-in-a-row.html
[sase]: https://www.sdxcentral.com/news/gartner-sase-2026-rankings-netskope-leads-cato-networks-leaps-and-palo-alto-networks-falls/
[infoblox]: https://www.infoblox.com/company/why-infoblox/market-leadership/
[eip]: https://efficientip.com/news-events
[cisco-3825]: https://newsroom.cisco.com/c/r/newsroom/en/us/a/y2004/m09/cisco-systems-introduces-new-portfolio-of-integrated-services-routers-for-highly-secure-wire-speed-delivery-of-concurrent-data-voice-and-video-applica.html
[cisco-3825-eol]: https://www3-realm.cisco.com/en/US/prod/collateral/routers/ps5855/eol_c51_624090.html
[c8200]: https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8200-series-edge-platforms/nb-06-cat8200-series-edge-plat-ds-cte-en.html
[c8300]: https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8300-series-edge-platforms/datasheet-c78-744088.html
[c8500]: https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8500-series-edge-platforms/datasheet-c78-744089.html
[mx204]: https://www.juniper.net/gb/en/products/routers/mx-series/mx204-universal-routing-platform.html
[mx304]: https://www.juniper.net/us/en/products/routers/mx-series/mx304-universal-routing-platform/specs.html
[c9200]: https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html
[c9300]: https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html
[c9500]: https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9500-series-switches/nb-06-cat9500-ser-data-sheet-cte-en.html
[nx-fx3]: https://www.cisco.com/c/en/us/products/collateral/switches/nexus-9000-series-switches/nexus-9300-fx3-series-switch-ds.html
[nx-gx2]: https://www.cisco.com/c/en/us/products/collateral/switches/nexus-9000-series-switches/datasheet-c78-743854.html
[a-720xp]: https://www.arista.com/en/products/720xp-series
[a-7050x3]: https://www.arista.com/assets/data/pdf/Datasheets/7050X3-Datasheet.pdf
[ex2300]: https://www.juniper.net/gb/en/products/switches/ex-series/ex2300-ethernet-switch/specs.html
[ex4400]: https://www.juniper.net/gb/en/products/switches/ex-series/ex4400-ethernet-switch/specs.html
[ex4650]: https://www.juniper.net/content/dam/www/assets/datasheets/us/en/switches/ex4650-ethernet-switch-datasheet.pdf
[qfx5120]: https://www.juniper.net/gb/en/products/switches/qfx-series/qfx5120-data-center-switches/specs.html
[qfx5240]: https://www.juniper.net/gb/en/products/switches/qfx-series/qfx5240-data-center-switches/specs.html
[cx6100]: https://assets.ext.hpe.com/is/content/hpedam/a00021859enw
[cx6300]: https://assets.ext.hpe.com/is/content/hpedam/a00073540enw
[cx8360]: https://assets.ext.hpe.com/is/content/hpedam/a50004274enw
[pa400]: https://www.paloaltonetworks.com/apps/pan/public/downloadResource?pagePath=/content/pan/en_US/resources/datasheets/pa-400-series
[pa3400]: https://www.paloaltonetworks.com/apps/pan/public/downloadResource?pagePath=/content/pan/en_US/resources/datasheets/pa-3400-series
[pa5400]: https://www.paloaltonetworks.com/apps/pan/public/downloadResource?pagePath=/content/pan/en_US/resources/datasheets/pa-5400-series
[fg70g]: https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/pdf/fortigate-fortiwifi-70g-series.pdf
[fg400f]: https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/fortigate-400f-series.pdf
[fg3700f]: https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/fortigate-3700f-series.pdf
[csf1200]: https://www.cisco.com/c/en/us/products/collateral/security/firewalls/secure-firewall-1200-series-ds.html
[csf3100]: https://www.cisco.com/c/en/us/products/collateral/security/firewalls/secure-firewall-3100-series-ds.html
[csf4200]: https://www.cisco.com/c/en/us/products/collateral/security/firewalls/secure-firewall-4200-ds.html
[cp3920]: https://www.checkpoint.com/downloads/products/quantum-force-3920-datasheet.pdf
[cp9100]: https://www.checkpoint.com/downloads/products/quantum-force-9100-datasheet.pdf
[cp19100]: https://www.checkpoint.com/downloads/products/quantum-force-19100-datasheet.pdf
[srx300]: https://www.juniper.net/gb/en/products/security/srx-series/srx300-line-firewalls-branch-datasheet.html
[srx2300]: https://www.juniper.net/content/dam/www/assets/datasheets/us/en/security/srx2300-firewall-datasheet.pdf
[srx4600]: https://www.juniper.net/gb/en/products/security/srx-series/srx4600-firewall-datasheet.html
[f5-rseries]: https://www.f5.com/pdf/products/f5-application-delivery-controller-system-rseries-data-sheet.pdf
[netscaler]: https://www.netscaler.com/content/dam/netscaler/documents/data-sheet/netscaler-data-sheet.pdf
[tolly]: https://dl.ubnt.com/Tolly212128UbiquitiEdgeRouterLitePricePerformanceVsMikroTik.pdf
[selabs]: https://selabs.uk/wp-content/uploads/2025/07/advanced-performance-test-report-cisco-secure-firewall-4225-2025-05.pdf
[pan-ha]: https://docs.paloaltonetworks.com/pan-os/11-1/pan-os-admin/high-availability/ha-concepts/ha-timers
[asa-ha]: https://www.cisco.com/c/en/us/td/docs/security/asa/asa922/configuration/general/asa-922-general-config/ha-failover.html
[f5-ha]: https://community.f5.com/discussions/technicalforum/network-failover-timers/157219
[fgcp]: https://docs2.fortinet.com/document/fortigate/8.0.0/administration-guide/713706
[cisco-icons]: https://www.cisco.com/c/en/us/about/brand-center/network-topology-icons.html
[cisco-terms]: https://www.cisco.com/c/en/us/about/legal/terms-conditions.html
[juniper-icons]: https://www.juniper.net/us/en/products/icons-and-stencils.html
[juniper-terms]: https://www.juniper.net/us/en/company/images.html
[fortinet-icons]: https://www.fortinet.com/resources/icon-library
[f5-icons]: https://www.f5.com/resources/visio-stencils
[si]: https://simpleicons.org
[si-disclaimer]: https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md

A few figures came from secondary copies and are marked so in the research notes: the Cisco 3825's end-of-life dates
(Cisco's notice timed out; read from a third-party copy), IDC's 4Q24 security appliance shares (a search snippet; the
page returned 403) and F5's 3 s failover default (community posts). Fortinet as a 2026 LAN Leader, Cisco and VeloCloud
as SD-WAN Leaders, and the QFX5220/5230 figures are unverified and not used.
