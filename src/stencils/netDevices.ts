import { baseStencilId } from "./vendorParents";
// On-prem network devices: routers, switches, firewalls and application delivery controllers (ADCs). Each device
// stencil is a gateway (a pass-through hop) with a throughput ceiling from a size preset: branch, campus or data
// centre. Presets are approximate, from the vendors' datasheets (docs/research/network-infrastructure.md lists the
// model, the test condition and the source behind every number), and every value stays editable per node. Pure
// data: no UI registry and no Vite assets, so the engine and the checks can import it headlessly.

export type DeviceKind = "router" | "switch" | "firewall" | "adc";
export type DeviceSize = "branch" | "campus" | "datacentre";
export type DeviceHa = "standalone" | "active-standby" | "active-active";

export const DEVICE_SIZES: readonly DeviceSize[] = ["branch", "campus", "datacentre"];
export const SIZE_LABEL: Record<DeviceSize, string> = { branch: "Branch", campus: "Campus", datacentre: "Data centre" };
export const HA_LABEL: Record<DeviceHa, string> = {
  standalone: "Standalone",
  "active-standby": "Active-standby pair",
  "active-active": "Active-active cluster",
};

export interface DevicePreset {
  /** The datasheet model the numbers come from, e.g. "PA-3440". */
  model: string;
  /**
   * Datasheet throughput per unit, Gbps: a router's IPsec figure, a switch's switching capacity (both directions), a
   * firewall's with threat prevention on, an ADC's L7 throughput.
   */
  gbps: number;
  /** Time through the device per message, ms. */
  latencyMs: number;
}

export interface DeviceSpec {
  kind: DeviceKind;
  /** The size a new node starts at. */
  size: DeviceSize;
  /** A family made only for data centres (Nexus, QFX, MX) has no branch size. */
  presets: Partial<Record<DeviceSize, DevicePreset>>;
}

/** The average message the throughput is converted with, kB (1,000 bytes): an HTTP transaction with its reply. */
export const DEFAULT_MESSAGE_KB = 64;
/** How long an active-standby pair stalls when its active unit fails, ms: a few seconds with default HA timers. */
export const DEFAULT_FAILOVER_MS = 3000;

const p = (model: string, gbps: number, latencyMs: number): DevicePreset => ({ model, gbps, latencyMs });
type Presets = [branch: DevicePreset | null, campus: DevicePreset, datacentre: DevicePreset];
const spec = (kind: DeviceKind, size: DeviceSize, [branch, campus, datacentre]: Presets): DeviceSpec => ({
  kind,
  size,
  presets: { ...(branch ? { branch } : {}), campus, datacentre },
});

// Latency: routers about 50 µs (Tolly's tests of small routers), switches their datasheets' port-to-port figure
// (or a few µs where none is published), NGFWs half a millisecond per inspected HTTP transaction (SE Labs), ADCs a
// fifth of a millisecond to proxy one (an assumption: no vendor publishes it).
const ROUTER_MS = 0.05;
const FIREWALL_MS = 0.5;
const ADC_MS = 0.2;

/** By stencil id. Ids are persisted in saved diagrams: never rename one once shipped. */
export const DEVICE_SPECS: Readonly<Record<string, DeviceSpec>> = {
  // Routers: IPsec throughput with 1,400-byte packets (most WAN links are encrypted).
  "generic.router": spec("router", "campus", [
    p("branch router", 1, ROUTER_MS),
    p("campus router", 10, ROUTER_MS),
    p("edge router", 100, ROUTER_MS),
  ]),
  "cisco.isr": spec("router", "branch", [
    p("Catalyst 8200-1N-4T", 1, ROUTER_MS),
    p("Catalyst 8300-2N2S-4T2X", 18.9, ROUTER_MS),
    p("Catalyst 8500-12X4QC", 135, ROUTER_MS),
  ]),
  // MX: system throughput; there is no branch-sized MX.
  "juniper.mx": spec("router", "campus", [null, p("MX204", 400, ROUTER_MS), p("MX304", 4800, ROUTER_MS)]),
  // Switches: switching capacity, both directions.
  "generic.switch": spec("switch", "campus", [
    p("access switch", 176, 0.004),
    p("campus switch", 880, 0.002),
    p("data-centre leaf", 3600, 0.001),
  ]),
  "cisco.catalyst": spec("switch", "campus", [
    p("Catalyst 9200-48P", 176, 0.004),
    p("Catalyst 9300-48P", 256, 0.004),
    p("Catalyst 9500-32C", 6400, 0.002),
  ]),
  "cisco.nexus": spec("switch", "datacentre", [
    null,
    p("Nexus 93180YC-FX3", 3600, 0.001),
    p("Nexus 9364D-GX2A", 51200, 0.001),
  ]),
  "arista.switch": spec("switch", "datacentre", [
    p("Arista 720XP-24ZY4", 360, 0.0012),
    p("Arista 720XP-48ZC2", 880, 0.0012),
    p("Arista 7050SX3-48YC8", 4000, 0.0008),
  ]),
  "juniper.ex": spec("switch", "campus", [
    p("EX2300-48P", 176, 0.004),
    p("EX4400-48P", 696, 0.002),
    p("EX4650-48Y", 4000, 0.00055),
  ]),
  "juniper.qfx": spec("switch", "datacentre", [
    null,
    p("QFX5120-48Y", 4000, 0.0008),
    p("QFX5240-64OD", 102400, 0.0008),
  ]),
  "aruba.cx": spec("switch", "campus", [
    p("CX 6100 48G", 176, 0.0019),
    p("CX 6300M 48-port", 880, 0.0015),
    p("CX 8360-48Y6C", 4800, 0.001),
  ]),
  // Firewalls: threat prevention throughput, what an NGFW delivers with its inspection on (each vendor's own mix).
  "generic.ngfw": spec("firewall", "campus", [
    p("branch firewall", 1.2, FIREWALL_MS),
    p("campus firewall", 9, FIREWALL_MS),
    p("data-centre firewall", 70, FIREWALL_MS),
  ]),
  "paloalto.ngfw": spec("firewall", "campus", [
    p("PA-440", 1.2, FIREWALL_MS),
    p("PA-3440", 20, FIREWALL_MS),
    p("PA-5440", 70, FIREWALL_MS),
  ]),
  "fortinet.fortigate": spec("firewall", "campus", [
    p("FortiGate 70G", 1.3, FIREWALL_MS),
    p("FortiGate 400F", 9, FIREWALL_MS),
    p("FortiGate 3700F", 75, FIREWALL_MS),
  ]),
  "cisco.secure-firewall": spec("firewall", "campus", [
    p("Secure Firewall 1210", 6, FIREWALL_MS),
    p("Secure Firewall 3130", 38, FIREWALL_MS),
    p("Secure Firewall 4245", 140, FIREWALL_MS),
  ]),
  "checkpoint.quantum": spec("firewall", "campus", [
    p("Quantum Force 3920", 3.2, FIREWALL_MS),
    p("Quantum Force 9100", 6.5, FIREWALL_MS),
    p("Quantum Force 19100", 35, FIREWALL_MS),
  ]),
  "juniper.srx": spec("firewall", "campus", [
    p("SRX345", 0.295, FIREWALL_MS),
    p("SRX2300", 6, FIREWALL_MS),
    p("SRX4600", 10.5, FIREWALL_MS),
  ]),
  // ADCs: L7 throughput. Their L7 requests/s are measured with tiny pages: at 64 kB a message, throughput binds first.
  "generic.adc": spec("adc", "campus", [
    p("branch ADC", 10, ADC_MS),
    p("campus ADC", 50, ADC_MS),
    p("data-centre ADC", 190, ADC_MS),
  ]),
  "f5.bigip": spec("adc", "campus", [
    p("BIG-IP r2600", 13, ADC_MS),
    p("BIG-IP r5900", 95, ADC_MS),
    p("BIG-IP r10900", 190, ADC_MS),
  ]),
  "netscaler.adc": spec("adc", "campus", [
    p("NetScaler MPX 9210", 10, ADC_MS),
    p("NetScaler MPX 9230", 30, ADC_MS),
    p("NetScaler MPX 17000Z", 350, ADC_MS),
  ]),
};

export function deviceSpec(stencil: string | undefined): DeviceSpec | undefined {
  return stencil === undefined ? undefined : DEVICE_SPECS[stencil];
}

export const isDevice = (stencil: string | undefined) => deviceSpec(stencil) !== undefined;
export const isFirewallStencil = (stencil: string | undefined) =>
  (stencil !== undefined && baseStencilId(stencil) === "generic.firewall") || deviceSpec(stencil)?.kind === "firewall";

export const isDeviceSize = (v: unknown): v is DeviceSize => v === "branch" || v === "campus" || v === "datacentre";
export const isDeviceHa = (v: unknown): v is DeviceHa =>
  v === "standalone" || v === "active-standby" || v === "active-active";

/** The sizes a family comes in, smallest first. */
export const sizesOf = (spec: DeviceSpec): DeviceSize[] => DEVICE_SIZES.filter((s) => spec.presets[s]);

/** The size a node is at: its own, when the family comes in it, else the family's default. */
export function sizeOf(spec: DeviceSpec, size: unknown): DeviceSize {
  return isDeviceSize(size) && spec.presets[size] ? size : spec.size;
}

/** The preset of a size the family comes in (sizeOf's answer always is). */
export const presetOf = (spec: DeviceSpec, size: DeviceSize): DevicePreset =>
  spec.presets[size] ?? spec.presets[spec.size]!;

/** Messages per second a link of `gbps` carries at `messageKB` per message. */
export function messagesPerSec(gbps: number, messageKB = DEFAULT_MESSAGE_KB): number {
  return messageKB > 0 ? (gbps * 1e9) / 8 / (messageKB * 1000) : Infinity;
}

/** Units that carry traffic: one in an active-standby pair (the other waits), every one otherwise. */
export function activeUnits(ha: DeviceHa, units: number): number {
  return ha === "active-standby" ? Math.min(1, units) : units;
}

/**
 * Whether an edge's props make it a deny rule. Fails closed: anything set that isn't `false` denies, so a malformed
 * value (a string, a number) never quietly lets traffic through. Opening a file says so (src/interop/native.ts).
 */
export const isDenyRule = (props: Record<string, unknown> | undefined): boolean =>
  props?.deny !== undefined && props.deny !== false;
