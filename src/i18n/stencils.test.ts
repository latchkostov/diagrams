import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { catalog } from "../stencils/catalog";
import { FALLBACK_STENCIL } from "../stencils/registry";
import { searchStencils } from "../lib/stencilDisplaySearch";
import { quickAddMenu, stencilMenu } from "../editor/builtinActions";
import { findStencils, resolveKind } from "../ai/stencils";
import { STENCIL_ALIASES } from "../lib/stencilSearch";
import { searchStencils as englishSearch } from "../lib/stencilSearch";
import { state, type Catalog } from "./core";
import en from "./en";
import { sourceHash } from "./validate";
import { parse, textOf } from "./icu";
import { pseudoLocalize } from "./pseudo";
import * as searchCore from "../lib/stencilSearchCore";
import { categoryLabel } from "./chrome";
import { stencilLabel, stencilDescription, stencilSubtitle, vendorLabel } from "./stencils";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

describe("stencil display text", () => {
  it("preserves every English name, description, subtitle and vendor byte for byte", () => {
    for (const s of [...catalog, FALLBACK_STENCIL]) {
      expect(stencilLabel(s), s.id).toBe(s.label);
      expect(stencilDescription(s), s.id).toBe(s.description);
      expect(stencilSubtitle(s), s.id).toBe(s.defaultSublabel);
      expect(vendorLabel(s.vendor), s.id).toBe(s.vendor);
    }
  });

  it("pseudo-locale localizes every translatable stencil field", async () => {
    state.l = "en-XA";
    state.c = (await catalogs["en-XA"]()).default as Catalog;
    // Complete product names stay verbatim; product + common-noun names (Kafka Topic) translate.
    const protectedNames = new Set([
      "client.react",
      "client.vue",
      "client.angular",
      "client.svelte",
      "client.nextjs",
      "client.nuxt",
      "client.react-native",
      "client.flutter",
      "client.swiftui",
      "client.compose",
      "kafka.connect",
      "kafka.ksqldb",
      "azure.event-hubs",
      "azure.event-grid",
      "azure.storage-queue",
      "aws.sqs",
      "aws.sns",
      "aws.eventbridge",
      "aws.kinesis",
      "gcp.pubsub",
      "confluent.cloud",
      "kafka.streams",
      "debezium",
      "aws.msk",
      "aws.mq",
      "azure.functions",
      "azure.app-service",
      "azure.container-apps",
      "azure.aks",
      "azure.logic-apps",
      "azure.signalr",
      "aws.lambda",
      "aws.ecs",
      "aws.step-functions",
      "flink",
      "gcp.dataflow",
      "temporal",
      "camunda",
      "airflow",
      "gcp.cloud-run",
      "gcp.cloud-functions",
      "gcp.gke",
      "azure.static-web-apps",
      "vercel",
      "netlify",
      "cloudflare.workers",
      "graphql",
      "postgres",
      "mysql",
      "sqlserver",
      "azure.sql",
      "azure.cosmos-db",
      "azure.blob-storage",
      "azure.redis",
      "mongodb",
      "elasticsearch",
      "aws.s3",
      "aws.dynamodb",
      "snowflake",
      "adobe.aem",
      "databricks",
      "gcp.bigquery",
      "gcp.spanner",
      "gcp.cloud-sql",
      "gcp.firestore",
      "aws.redshift",
      "aws.aurora",
      "cassandra",
      "clickhouse",
      "supabase",
      "firebase",
      "minio",
      "pinecone",
      "azure.data-factory",
      "azure.synapse",
      "microsoft-fabric",
      "azure.api-management",
      "azure.front-door",
      "azure.app-gateway",
      "aws.api-gateway",
      "aws.elb",
      "nginx",
      "kong",
      "cloudflare",
      "envoy",
      "istio",
      "linkerd",
      "traefik",
      "haproxy",
      "generic.cdn",
      "generic.dns",
      "cisco.isr",
      "juniper.mx",
      "cisco.catalyst",
      "cisco.nexus",
      "juniper.ex",
      "juniper.qfx",
      "aruba.cx",
      "paloalto.ngfw",
      "fortinet.fortigate",
      "cisco.secure-firewall",
      "checkpoint.quantum",
      "juniper.srx",
      "generic.adc",
      "f5.bigip",
      "netscaler.adc",
      "grafana",
      "prometheus",
      "datadog",
      "azure.app-insights",
      "splunk",
      "loki",
      "jaeger",
      "kibana",
      "new-relic",
      "sentry",
      "aws.cloudwatch",
      "azure.key-vault",
      "entra-id",
      "vault",
      "okta",
      "auth0",
      "keycloak",
      "azure.app-config",
      "azure.managed-identity",
      "aws.secrets-manager",
      "aws.parameter-store",
      "aws.iam-role",
      "gcp.service-account",
      "gcp.secret-manager",
      "k8s.configmap",
      "iterable",
      "braze",
      "segment",
      "shopify",
      "paypal",
      "adyen",
      "stripe",
      "twilio",
      "sendgrid",
      "salesforce",
      "hubspot",
      "slack",
      "github",
      "openai",
      "anthropic.claude",
      "generic.sms",
      "github-actions",
      "terraform",
      "argocd",
      "dbt",
      "airbyte",
      "snowflake.snowpipe",
      "gcp.cloud-storage",
      "looker",
      "tableau",
      "aws.route53",
      "azure.traffic-manager",
      "gcp.cloud-load-balancing",
    ]);
    // Protocols, product series and resource identifiers are technical text, not translated nouns.
    const protectedSubtitles = new Set([
      "cdc",
      "DAG",
      "graphql",
      "grpc",
      "postgres",
      "API",
      "ALB",
      "dns",
      "waf",
      "PA-Series",
      "NGFW",
      "Firepower",
      "LTM",
      "APM",
      "apm",
      "configmap",
      "api",
      "crm",
      "llm",
      "sms",
      "cron",
      "iac",
      "gitops",
      "IdP",
      "ELT",
      "BI",
      "DNS",
    ]);
    const pseudo = (text: string) => textOf(pseudoLocalize(parse(text)));
    for (const s of [...catalog, FALLBACK_STENCIL]) {
      // Framework names are ICU values: preserve the brand inside the translated sentence too.
      const description =
        s.id.startsWith("client.") && protectedNames.has(s.id)
          ? textOf(
              pseudoLocalize(parse(s.description.replace(s.label, "{framework}"))).map((part) =>
                part.type === "arg" ? { type: "text" as const, value: s.label } : part,
              ),
            )
          : pseudo(s.description);
      expect(stencilDescription(s), `${s.id}: description`).toBe(description);
      expect(stencilLabel(s), `${s.id}: name`).toBe(protectedNames.has(s.id) ? s.label : pseudo(s.label));
      expect(stencilSubtitle(s), `${s.id}: subtitle`).toBe(
        s.defaultSublabel && !protectedSubtitles.has(s.defaultSublabel) ? pseudo(s.defaultSublabel) : s.defaultSublabel,
      );
    }
    expect(vendorLabel("Generic")).toBe(pseudo("Generic"));
    expect(vendorLabel("Client")).toBe(pseudo("Client"));
  });

  it("English and display discovery share token weights and stable ranking", async () => {
    state.l = "de";
    state.c = (await catalogs.de()).default as Catalog;
    const database = catalog.find((s) => s.id === "generic.database")!;
    const queue = catalog.find((s) => s.id === "generic.queue")!;
    const topic = catalog.find((s) => s.id === "generic.topic")!;
    const score = vi.spyOn(searchCore, "scoreToken").mockImplementation((ix, token) => {
      // A future scoring change must affect both indexes; each token can use a different one.
      if (token === "english") return ix.label === "queue" || ix.label === "topic" ? 17 : 0;
      if (token === "translated") return ix.label === stencilLabel(database).toLowerCase() ? 31 : 0;
      if (token === "mixed") return ix.label === "database" ? 23 : 0;
      return 0;
    });
    try {
      const list = [database, topic, queue];
      expect(englishSearch(list, "english")).toEqual([topic, queue]);
      expect(searchStencils(list, "english")).toEqual([topic, queue]);
      expect(searchStencils(list, "translated")).toEqual([database]);
      expect(searchStencils(list, "translated mixed")).toEqual([database]);
      expect(searchStencils(list, "translated missing")).toEqual([]);
      expect(searchStencils(list, "")).toEqual(list);
    } finally {
      score.mockRestore();
    }
  });

  it("preserves English discovery results, including family counts for abbreviated product names", () => {
    const queries = catalog.flatMap((s) => [s.label, s.id, ...(STENCIL_ALIASES[s.id] ?? [])]);
    for (const query of queries) expect(searchStencils(catalog, query), query).toEqual(englishSearch(catalog, query));
    expect(searchStencils(catalog, "sqs").map((s) => s.id)).toEqual(["aws.sqs"]);
  });

  it.each(Object.keys(catalogs).filter((code) => code !== "en-XA"))(
    "%s uses its approved network-firewall vocabulary in names, subtitles and descriptions",
    (code) => {
      const read = (dir: string) =>
        JSON.parse(fs.readFileSync(path.resolve("src/i18n", dir, `${code}.json`), "utf8")) as Record<string, string>;
      const messages = read("locales");
      const glossary = JSON.parse(fs.readFileSync(path.resolve("src/i18n/glossary", `${code}.json`), "utf8")) as {
        terms: { firewall: { use: string; match?: string[]; avoid?: string[] } };
      };
      const term = glossary.terms.firewall;
      const accepted = [term.use, ...(term.match ?? [])].map((text) => text.toLocaleLowerCase(code));
      for (const [key] of Object.entries(en).filter(([, english]) => /\bfirewalls?\b/i.test(english))) {
        expect(
          accepted.some((word) => messages[key].toLocaleLowerCase(code).includes(word)),
          key,
        ).toBe(true);
        for (const bad of term.avoid ?? []) {
          expect(messages[key].toLocaleLowerCase(code), key).not.toContain(bad.toLocaleLowerCase(code));
        }
      }
    },
  );

  it.each(Object.keys(catalogs).filter((code) => code !== "en-XA"))(
    "%s translates every extracted message with a current source stamp",
    (code) => {
      const read = (file: string) =>
        JSON.parse(fs.readFileSync(path.resolve("src/i18n/locales", file), "utf8")) as Record<string, string>;
      const messages = read(`${code}.json`);
      const meta = JSON.parse(fs.readFileSync(path.resolve("src/i18n/locales", `${code}.meta.json`), "utf8")) as {
        sources: Record<string, string>;
      };
      for (const [key, english] of Object.entries(en).filter(([key]) => key.startsWith("stencil."))) {
        expect(messages[key], key).toBeTruthy();
        expect(meta.sources[key], key).toBe(sourceHash(english));
      }
    },
  );

  it.each(["de", "ja", "ar", "en-XA"])("%s localizes discovery without mutating agent/file records", async (code) => {
    const before = JSON.stringify(catalog);
    const database = catalog.find((s) => s.id === "generic.database")!;
    const kafka = catalog.find((s) => s.id === "kafka.topic")!;
    const menuBeforeSwitch = stencilMenu("change", () => ({}));
    const recentBeforeSwitch = quickAddMenu(() => {}, [database.id]);
    // Pin every English agent name/alias result, including ranking, then repeat with a UI locale loaded.
    const queries = [...new Set(catalog.flatMap((s) => [s.label, s.id, ...(STENCIL_ALIASES[s.id] ?? [])]))];
    const agents = queries.map((query) => findStencils(query));
    const resolved = queries.map((query) => resolveKind(query));
    // Populate the same object's English search cache, then switch language.
    searchStencils(catalog, "database");
    state.l = code;
    state.c = (await catalogs[code]()).default as Catalog;
    expect(stencilLabel(database)).not.toBe(database.label);
    expect(stencilDescription(database)).not.toBe(database.description);
    expect(stencilSubtitle(database)).not.toBe(database.defaultSublabel);
    if (code !== "en-XA") expect(stencilLabel(kafka)).toContain("Kafka");
    for (const id of ["stripe", "iterable", "aws.lambda", "cisco.isr", "f5.bigip"]) {
      const s = catalog.find((s) => s.id === id)!;
      expect(stencilLabel(s), id).toBe(s.label);
    }
    expect(searchStencils(catalog, stencilLabel(database))[0]).toBe(database);
    expect(searchStencils(catalog, "database")[0]).toBe(database);
    expect(searchStencils(catalog, "pg")[0].id).toBe("postgres");
    expect(searchStencils(catalog, stencilDescription(database))).toContain(database);
    expect(queries.map((query) => findStencils(query))).toEqual(agents);
    expect(queries.map((query) => resolveKind(query))).toEqual(resolved);
    expect(resolveKind("IoT devices").id).toBe("client.iot");
    const generic = menuBeforeSwitch.find((n) => n.type === "item" && n.id === "change:cat:generic");
    expect(generic?.type === "item" && generic.label).toBe(categoryLabel.generic);
    expect(
      generic?.type === "item" && generic.children?.find((n) => n.type === "item" && n.stencil === database.id),
    ).toMatchObject({ label: stencilLabel(database) });
    expect(recentBeforeSwitch).toContainEqual(expect.objectContaining({ label: stencilLabel(database) }));
    expect(JSON.stringify(catalog)).toBe(before);
    state.l = "en";
    state.c = undefined;
    expect(searchStencils(catalog, "database")[0]).toBe(database);
  });
});
