import { describe, expect, it } from "vitest";
import { inferKind } from "./edgeKind";

// The review's rule (docs/research/sim-flows-review.md, F-19): a Request into a store, a sink, a gateway or a model
// API, or out of a client or a gateway; a Message into and out of brokers, which wins, and otherwise.

describe("the kind a new flow starts as", () => {
  it.each([
    ["service.dotnet", "postgres", "into a database"],
    ["service.go", "redis.cache", "into a cache"],
    ["service.java", "stripe", "into an outside API (a sink)"],
    ["service.node", "generic.external-api", "into a generic outside API"],
    ["service.node", "generic.email", "into email"],
    ["service.python", "openai", "into a model API"],
    ["service.python", "anthropic.claude", "into Claude"],
    ["aws.lambda", "generic.llm", "into an LLM"],
    ["service.node", "nginx", "into a gateway"],
    ["client.browser", "service.dotnet", "out of a browser"],
    ["client.mobile", "aws.lambda", "out of a mobile app"],
    ["generic.webhook", "service.node", "out of a webhook"],
    ["nginx", "service.go", "out of a gateway"],
    ["client.user", "azure.front-door", "a client into a gateway"],
  ])("%s → %s is a Request (%s)", (from, to) => {
    expect(inferKind(from, to)).toBe("sync");
  });

  it.each([
    ["service.dotnet", "kafka.topic", "into a topic"],
    ["kafka.topic", "service.dotnet", "out of a topic"],
    ["client.browser", "aws.sqs", "a client into a queue"],
    ["azure.api-management", "azure.service-bus.queue", "a gateway into a queue"],
    ["aws.sqs", "postgres", "a queue into a database (a sink connector)"],
    ["service.node", "kafka.cluster", "into Kafka Cluster"],
    ["service.node", "service.go", "between services"],
    ["postgres", "debezium", "out of a database (a change feed)"],
    ["generic.scheduler", "service.go", "out of a scheduler"],
    ["service.node", undefined, "to a shape"],
    [undefined, "postgres", "from a shape"],
  ] as [string | undefined, string | undefined, string][])("%s → %s is a Message (%s)", (from, to) => {
    expect(inferKind(from, to)).toBe("async");
  });
});
