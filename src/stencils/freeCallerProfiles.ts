import { baseStencilId } from "./vendorParents";
import type { StencilProfile } from "./profiles";

/** The family records used by canvas wait defaults; full presets remain lazy. */
export const FREE_CALLER_PROFILES: Readonly<Record<string, StencilProfile>> = {
  "azure.logic-apps": { family: "workflow" },
  "azure.signalr": { family: "proxy" },
  "aws.step-functions": { family: "workflow" },
  temporal: { family: "workflow" },
  camunda: { family: "workflow" },
  graphql: { family: "api-gateway" },
  "azure.api-management": { family: "api-gateway" },
  "azure.front-door": { family: "edge" },
  "azure.app-gateway": { family: "proxy" },
  "aws.api-gateway": { family: "api-gateway" },
  "aws.elb": { family: "proxy" },
  nginx: { family: "proxy" },
  kong: { family: "api-gateway" },
  cloudflare: { family: "edge" },
  "load-balancer": { family: "proxy" },
  envoy: { family: "proxy" },
  istio: { family: "mesh" },
  linkerd: { family: "mesh" },
  traefik: { family: "proxy" },
  haproxy: { family: "proxy" },
  "generic.cdn": { family: "edge" },
  "generic.firewall": { family: "device" },
  "generic.router": { family: "device" },
  "cisco.isr": { family: "device" },
  "juniper.mx": { family: "device" },
  "generic.switch": { family: "device" },
  "cisco.catalyst": { family: "device" },
  "cisco.nexus": { family: "device" },
  "arista.switch": { family: "device" },
  "juniper.ex": { family: "device" },
  "juniper.qfx": { family: "device" },
  "aruba.cx": { family: "device" },
  "generic.ngfw": { family: "device" },
  "paloalto.ngfw": { family: "device" },
  "fortinet.fortigate": { family: "device" },
  "cisco.secure-firewall": { family: "device" },
  "checkpoint.quantum": { family: "device" },
  "juniper.srx": { family: "device" },
  "generic.adc": { family: "device" },
  "f5.bigip": { family: "device" },
  "netscaler.adc": { family: "device" },
  "gcp.cloud-load-balancing": { family: "proxy" },
  "generic.saga": { family: "workflow" },
};

export const holdsThreadByDefault = (stencil: string) => !Object.hasOwn(FREE_CALLER_PROFILES, baseStencilId(stencil));
export const holdsCallerThread = (stencil: string, wait?: "blocking" | "non-blocking") =>
  wait ? wait === "blocking" : holdsThreadByDefault(stencil);
