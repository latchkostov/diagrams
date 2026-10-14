import { describe, expect, it } from "vitest";
import { productOf, readSetting } from "./settings";
import { diagnostic } from "./graph";
import { imageStencil, repositoryOf, resolveStencil, shortImage } from "./stencils";

describe("connections from settings", () => {
  it.each([
    [
      "SPRING_DATASOURCE_URL",
      "jdbc:postgresql://postgres:5432/orders",
      { type: "host", host: "postgres", scheme: "postgresql" },
    ],
    ["MONGO_URI", "mongodb+srv://u:p@cluster0.example.net/db", { type: "host", host: "cluster0.example.net" }],
    ["REDIS_HOST", "redis:6379", { type: "host", host: "redis" }],
    ["PAYMENTS_ENDPOINT", "payments", { type: "host", host: "payments" }],
    [
      "KAFKA_BOOTSTRAP_SERVERS",
      "PLAINTEXT://kafka-1:9092,kafka-2:9092",
      { type: "brokers", hosts: ["kafka-1", "kafka-2"] },
    ],
    ["spring.kafka.bootstrap-servers", "kafka:9092", { type: "brokers", hosts: ["kafka"] }],
    ["INPUT_TOPIC", "orders.placed.v1", { type: "topics", topics: ["orders.placed.v1"], dir: "read" }],
    ["CONSUME_TOPICS", "a,b", { type: "topics", topics: ["a", "b"], dir: "read" }],
    ["PUBLISH_TOPIC", "events", { type: "topics", dir: "write" }],
    ["ORDERS_TOPIC", "orders", { type: "topics", dir: "guess" }],
    ["KAFKA_GROUP_ID", "shipping", { type: "group", group: "shipping" }],
    ["DB_PASSWORD_FILE", "/run/secrets/db_password", { type: "secret", secret: "db_password" }],
  ])("%s", (name, value, expected) => {
    expect(readSetting(name, value)[0]).toMatchObject({ name, ...expected });
  });

  it("ignores this machine, bare IPs, unknown schemes, unrelated names and long values", () => {
    for (const [name, value] of [
      ["DATABASE_URL", "postgres://localhost:5432/x"],
      ["API_URL", "http://127.0.0.1:8080"],
      ["UPSTREAM", "tcp://mainframe:7000"],
      ["LISTENERS", "PLAINTEXT://kafka:9092"],
      ["LOG_LEVEL", "debug"],
      ["SERVICE_URL", `http://${"a".repeat(3000)}`],
      ["REDIS_HOST", "redis cache"],
    ])
      expect(readSetting(name, value), name).toEqual([]);
  });

  it("knows outside products by host", () => {
    expect(productOf("myvault.vault.azure.net")).toBe("azure.key-vault");
    expect(productOf("shop.servicebus.windows.net")).toBe("azure.service-bus.queue");
    expect(productOf("db.abc.eu-west-1.rds.amazonaws.com", "postgresql")).toBe("postgres");
    expect(productOf("sqs.eu-west-1.amazonaws.com")).toBe("aws.sqs");
    expect(productOf("api.payments.example.com")).toBeUndefined();
  });
});

describe("resolveStencil", () => {
  it("reads images from any registry, ignoring the tag", () => {
    expect(repositoryOf("docker.io/library/postgres:16")).toBe("postgres");
    expect(repositoryOf("ghcr.io/acme/web:4.2@sha256:abc")).toBe("acme/web");
    expect(repositoryOf("localhost:5000/team/api")).toBe("team/api");
    expect(repositoryOf("mcr.microsoft.com/mssql/server:2022-latest")).toBe("mssql/server");
    expect(shortImage("registry.example.com/integration/legacy-adapter:1.4")).toBe("legacy-adapter:1.4");
    expect(imageStencil("bitnami/kafka:3")).toBe("kafka.cluster");
    expect(imageStencil("mariadb:11")).toBe("mysql");
    expect(imageStencil("jaegertracing/all-in-one:1.6")).toBe("jaeger");
    expect(imageStencil("otel/opentelemetry-collector-contrib")).toBe("opentelemetry");
    expect(imageStencil("zookeeper")).toEqual({ skip: diagnostic("importDetail.partOfKafka") });
  });

  it("is sure of an image, a framework or a role; guesses otherwise", () => {
    expect(resolveStencil({ name: "db", image: "postgres:16" })).toMatchObject({ id: "postgres", confidence: "high" });
    expect(resolveStencil({ name: "x", env: ["SPRING_PROFILES_ACTIVE"] })).toMatchObject({
      id: "service.java",
      confidence: "high",
    });
    expect(resolveStencil({ name: "web", env: ["NODE_ENV"] })).toMatchObject({
      id: "service.node",
      confidence: "medium",
      evidence: "NODE_ENV",
    });
    expect(resolveStencil({ name: "billing-worker" })).toMatchObject({ id: "generic.service", confidence: "high" });
    expect(resolveStencil({ name: "zzqx" })).toMatchObject({ id: "generic.service", confidence: "low" });
  });
});
