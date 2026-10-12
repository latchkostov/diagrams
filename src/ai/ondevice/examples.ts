// The on-device model's system prompt and few-shot examples. The examples' own components have obvious
// placeholder names ("sample-worker"): a small model copied realistic ones ("Orders API", "Quill
// gateway") into answers to unrelated requests. New nodes in the answers are named as their request
// names them ("MySQL", "retry queue"), which is what the model should do too. compactOps.ts rejects a
// reply that reuses a placeholder (EXAMPLE_NAMES).

import type { InitialPrompt } from "./promptApi";

export const SYSTEM_PROMPT = `You change architecture diagrams. Reply with JSON only: {"summary": "<one short sentence>", "ops": [...]}.
Ops:
- {"op":"add","key":"<short id>","kind":"<the technology in plain words: Kafka topic, Service Bus queue, PostgreSQL, Redis cache, Go service, Python service, Java service, Lambda, browser>","label":"<short name>"}
- {"op":"connect","from":"<label or key>","to":"<label or key>","flow":"message" or "request"}
- {"op":"insert_between","key":"<short id>","kind":"<plain words>","label":"<short name>","from":"<label>","to":"<label>"} (puts a new node on the connection from -> to)
- {"op":"rename","target":"<label>","label":"<new label>"}
- {"op":"change_kind","target":"<label>","kind":"<plain words>"} ("make X a Y": X keeps its label and connections)
- {"op":"remove","target":"<label>"} (a connection: "<from label> -> <to label>")
Rules:
- Add every component the request names, give each a short key, and connect them by their keys.
- Name existing nodes by their exact label from the diagram. "this" is the selected node.
- Direction follows the data. "A calls / uses / writes to / sends to / publishes to / routes to / invokes / feeds B" goes from A to B. "A consumes / reads from / subscribes to / is fed by / is triggered by B" goes from B to A.
- flow is "message" for events and queues, "request" for HTTP, gRPC, SQL and cache calls.
- Use the names from the request, never the sample names from the examples.
- Keep it short: only the ops the request needs, labels of a few words, a one-line summary.`;

const EXAMPLE_DIAGRAM = `Diagram "Sample"
Nodes (label: kind):
- sample-batch: Batch Job
- sample.jobs: Kafka Topic
- sample-worker: .NET Service
- sample-store: PostgreSQL
Connections:
- sample-batch -> sample.jobs (message)
- sample.jobs -> sample-worker (message)
- sample-worker -> sample-store (request)`;

const answer = (summary: string, ops: object[]) => JSON.stringify({ summary, ops });

/** The system prompt and four short examples: a create with "reads from", two edits, a selection. */
export const INITIAL_PROMPTS: InitialPrompt[] = [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content: "Empty diagram.\n\nRequest: sample-app reads events from a NATS subject and saves them to MySQL",
  },
  {
    role: "assistant",
    content: answer("sample-app reads a NATS subject and writes to MySQL", [
      { op: "add", key: "events", kind: "NATS subject", label: "NATS subject" },
      { op: "add", key: "app", kind: "Go service", label: "sample-app" },
      { op: "add", key: "db", kind: "MySQL", label: "MySQL" },
      { op: "connect", from: "events", to: "app", flow: "message" },
      { op: "connect", from: "app", to: "db", flow: "request" },
    ]),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nRequest: Add a dead-letter queue after sample-worker and rename sample-store to sample-ledger`,
  },
  {
    role: "assistant",
    content: answer("Added a dead-letter queue after sample-worker and renamed sample-store", [
      { op: "add", key: "dlq", kind: "dead-letter queue", label: "dead-letter queue" },
      { op: "connect", from: "sample-worker", to: "dlq", flow: "message" },
      { op: "rename", target: "sample-store", label: "sample-ledger" },
    ]),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nRequest: Put a Redis cache between sample-worker and sample-store, and make sample-store a MongoDB`,
  },
  {
    role: "assistant",
    content: answer("Put a Redis cache in front of sample-store and made it MongoDB", [
      {
        op: "insert_between",
        key: "cache",
        kind: "Redis cache",
        label: "Redis cache",
        from: "sample-worker",
        to: "sample-store",
      },
      { op: "change_kind", target: "sample-store", kind: "MongoDB" },
    ]),
  },
  {
    role: "user",
    content: `${EXAMPLE_DIAGRAM}\n\nthis = sample-worker "sample-worker"\n\nRequest: Add a retry queue after this`,
  },
  {
    role: "assistant",
    content: answer("Added a retry queue after sample-worker", [
      { op: "add", key: "retry", kind: "queue", label: "retry queue" },
      { op: "connect", from: "sample-worker", to: "retry", flow: "message" },
    ]),
  },
];

/** The placeholder names the examples use ("sample-worker", "sample.jobs"): never meant in a real reply. */
export const EXAMPLE_NAMES: readonly string[] = [
  ...new Set([
    ...[...EXAMPLE_DIAGRAM.matchAll(/^- ([^:]+):/gm)].map((m) => m[1].trim()),
    ...INITIAL_PROMPTS.flatMap((p) => [...p.content.matchAll(/\bsample[-.][a-z]+/g)].map((m) => m[0])),
  ]),
].filter((n) => n.startsWith("sample"));
