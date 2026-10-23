import { baseStencilId } from "./vendorParents";
import type { SimRole } from "../model/types";
import { stencilRole } from "./roles";

// The kind a new flow takes from the stencils at its ends (docs/research/sim-flows-review.md, F-19): a Request
// (sync) where the caller expects an answer, a Message (async) into and out of brokers and everywhere else. Only
// new edges use it (drawn, quick-added, an agent's connect without a kind); files keep the kind they have.

/** Model APIs: processors in the catalogue, but called and answering like any outside API. */
const MODEL_APIS: ReadonlySet<string> = new Set(["openai", "anthropic.claude", "generic.llm", "generic.ml-model"]);

/** Queues, topics and streams, and Kafka Cluster (drawn as the broker it is, though it takes no part in Live). */
const isBroker = (stencil: string, role: SimRole) =>
  role === "queue" || role === "topic" || role === "stream" || stencil === "kafka.cluster";

/** People, apps, devices and webhooks calling in. */
const isClient = (stencil: string, role: SimRole) =>
  role === "source" && (stencil.startsWith("client.") || stencil === "generic.webhook");

/**
 * The kind of a new flow from `source` to `target` (stencil ids; undefined for a shape): a Request into a store,
 * a sink (an outside API, email, a partner), a gateway or a model API, or out of a client or a gateway; a Message
 * into or out of a broker, which wins, and otherwise.
 */
export function inferKind(source: string | undefined, target: string | undefined): "sync" | "async" {
  if (source === undefined || target === undefined) return "async";
  source = baseStencilId(source);
  target = baseStencilId(target);
  const from = stencilRole(source),
    to = stencilRole(target);
  if (isBroker(source, from) || isBroker(target, to)) return "async";
  if (to === "store" || to === "sink" || to === "gateway" || MODEL_APIS.has(target)) return "sync";
  return isClient(source, from) || from === "gateway" ? "sync" : "async";
}
