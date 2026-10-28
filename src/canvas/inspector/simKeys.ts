// Which settings have a control, for panels that only sort settings (NodeSettings, EdgeAdvanced). Their labels
// are in ./simFields.ts, with the simulation catalog that only its own surfaces wait for (docs/I18N.md).

/** The keys of ./simFields.ts's SIM_FIELDS (simKeys.test.ts keeps the two the same). */
export const SIM_FIELD_KEYS = [
  "ratePerSec",
  "latencyMs",
  "concurrency",
  "replicas",
  "jitter",
  "failureRate",
  "maxDeliveryCount",
  "partitions",
] as const;

// The message type and emits are edited with the message-type pickers (several nodes: MultiPanel's MESSAGE_FIELDS).
export const SIM_KEYS = new Set<string>([...SIM_FIELD_KEYS, "messageType", "emits"]);

// A setting leaves Custom properties only where a control for it shows: a device's own section, a firewall's rule.
// Anywhere else (an nginx with a `gbps`, a service's connection with `deny`) it stays there, to see, change or remove.
export const DEVICE_KEYS = new Set<string>([...SIM_KEYS, "size", "gbps", "messageKB", "ha", "failoverMs"]);

export const ADC_KEYS = new Set<string>([...DEVICE_KEYS, "healthChecks"]);

export const EDGE_KEYS = new Set([
  "group",
  "dlq",
  "travelMs",
  "filter",
  "emits",
  "share",
  "settings",
  "caller",
  "priority",
  "requestFilter",
]);

export const RULE_KEYS = new Set([...EDGE_KEYS, "deny"]);
