import { describe, expect, it } from "vitest";
import {
  derivedLabel,
  edgeSettings,
  edgeSettingsList,
  flowEdges,
  implicitLabel,
  isDependency,
  MAX_SETTINGS,
  parseSettings,
  parseSettingsEditor,
  edgeSemanticSignature,
  referencedSettings,
  relationLabel,
  relationOf,
  sanitizeSettings,
  settingsSummary,
  settingsText,
} from "./relations";

describe("relation of an edge", () => {
  it("defaults to flow, and treats unknown values as flow", () => {
    expect(relationOf({})).toBe("flow");
    expect(relationOf(undefined)).toBe("flow");
    expect(relationOf({ relation: "secret" })).toBe("secret");
    expect(relationOf({ relation: "ownership" })).toBe("flow");
    expect(isDependency({ relation: "flow" })).toBe(false);
    expect(isDependency({ relation: "deploy" })).toBe(true);
  });

  it("filters dependencies out, keeping the same array when there are none", () => {
    const flows = [{ id: "a" }, { id: "b", relation: "flow" as const }];
    expect(flowEdges(flows)).toBe(flows);
    expect(flowEdges([...flows, { id: "c", relation: "config" as const }]).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("names flows by kind and dependencies by their word", () => {
    expect(relationLabel("flow", "sync")).toBe("Request");
    expect(relationLabel("flow")).toBe("Message");
    expect(relationLabel("depends")).toBe("Depends on");
    expect(implicitLabel("flow", "async")).toBe("message");
    expect(implicitLabel("secret")).toBe("reads secrets");
    expect(implicitLabel("identity")).toBe("gets tokens from");
  });
});

describe("settings on config edges", () => {
  it("parses one key per line, ! marking a secret", () => {
    expect(parseSettings("Orders:PageSize\n  !ConnectionStrings:Orders  \n\n# comment\nFeatures:*")).toEqual([
      { key: "Orders:PageSize" },
      { key: "ConnectionStrings:Orders", secret: true },
      { key: "Features:*" },
    ]);
  });

  it("reads appsettings-style and .env-style lines, spotting secret references in values", () => {
    const text = [
      '"Orders:PageSize": 50,',
      '"Stripe:ApiKey": "@Microsoft.KeyVault(SecretUri=https://orders-kv.vault.azure.net/secrets/stripe)",',
      "TABLE_NAME=orders",
      "/aws/reference/secretsmanager/checkout/stripe",
      "DB_PASSWORD={{resolve:secretsmanager:prod/db}}",
    ].join("\n");
    expect(parseSettings(text)).toEqual([
      { key: "Orders:PageSize" },
      { key: "Stripe:ApiKey", secret: true },
      { key: "TABLE_NAME" },
      { key: "/aws/reference/secretsmanager/checkout/stripe", secret: true },
      { key: "DB_PASSWORD", secret: true },
    ]);
  });

  it("reads a whole appsettings.json (flattened) and `az appconfig kv list` output", () => {
    const appsettings = JSON.stringify({
      Orders: { PageSize: 50, Region: "eu" },
      ConnectionStrings: { Orders: { uri: "https://orders-kv.vault.azure.net/secrets/db" } },
    });
    expect(parseSettings(appsettings)).toEqual([
      { key: "Orders:PageSize" },
      { key: "Orders:Region" },
      { key: "ConnectionStrings:Orders", secret: true },
    ]);
    const kvList = JSON.stringify([
      { key: "Features:Beta", value: "true", contentType: null },
      {
        key: "Stripe:ApiKey",
        value: '{"uri":"https://orders-kv.vault.azure.net/secrets/stripe"}',
        contentType: "application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8",
      },
    ]);
    expect(parseSettings(kvList)).toEqual([{ key: "Features:Beta" }, { key: "Stripe:ApiKey", secret: true }]);
  });

  it("round-trips through the textarea form", () => {
    const s = [{ key: "A" }, { key: "B:C", secret: true }];
    expect(parseSettings(settingsText(s))).toEqual(s);
  });

  it("sanitises stored settings: drops junk and duplicates, bounds the list", () => {
    expect(sanitizeSettings("nope")).toBeUndefined();
    expect(sanitizeSettings([{ key: " a " }, { key: "a" }, { key: 3 }, null, { key: "b", secret: "yes" }])).toEqual([
      { key: "a" },
      { key: "b" },
    ]);
    const many = Array.from({ length: MAX_SETTINGS + 50 }, (_, i) => ({ key: `k${i}` }));
    expect(sanitizeSettings(many)).toHaveLength(MAX_SETTINGS);
    expect(edgeSettings({ props: { settings: [{ key: "x", secret: true }] } })).toEqual([{ key: "x", secret: true }]);
  });

  it("summarises a list as N settings · M secret", () => {
    expect(settingsSummary([])).toBeUndefined();
    expect(settingsSummary([{ key: "a" }])).toBe("1 setting");
    expect(settingsSummary([{ key: "a" }, { key: "b" }, { key: "c", secret: true }, { key: "d", secret: true }])).toBe(
      "4 settings · 2 secret",
    );
  });

  it("derives labels: the summary on config edges, N references on the store's secret edge", () => {
    const edges = [
      {
        from: "api",
        to: "cfg",
        relation: "config" as const,
        props: { settings: [{ key: "a" }, { key: "s1", secret: true }, { key: "s2", secret: true }] },
      },
      // A second reader shares one reference and adds one.
      {
        from: "worker",
        to: "cfg",
        relation: "config" as const,
        props: {
          settings: [
            { key: "s1", secret: true },
            { key: "s3", secret: true },
          ],
        },
      },
      { from: "cfg", to: "kv", relation: "secret" as const },
      { from: "api", to: "kv", relation: "secret" as const },
      { from: "api", to: "db" },
    ];
    expect(derivedLabel(edges[0], edges)).toBe("3 settings · 2 secret");
    expect(derivedLabel(edges[2], edges)).toBe("3 references");
    expect(referencedSettings(edges, "cfg").map((s) => s.key)).toEqual(["s1", "s2", "s3"]);
    expect(edgeSettingsList(edges[2], edges)).toHaveLength(3);
    // A direct secret read references nothing; flows never get derived text.
    expect(derivedLabel(edges[3], edges)).toBeUndefined();
    expect(derivedLabel(edges[4], edges)).toBeUndefined();
  });
});

describe("settings privacy and editor regressions", () => {
  it("rejects oversized structured input instead of capturing a credential as a key", () => {
    const text = JSON.stringify({ Password: "Fake-password-7!", Padding: "x".repeat(1_000_000) });
    expect(() => parseSettings(text)).toThrow(/too large/i);
  });
  it("rejects deeply nested values before secret detection", () => {
    const text = '{"nested":'.repeat(12_000) + '"Fake-password-7!"' + "}".repeat(12_000);
    expect(() => parseSettings(text)).toThrow(/nesting/i);
  });
  it("rejects malformed structured paste instead of storing its values", () => {
    expect(() => parseSettings('{"Password":"Fake-password-7!",')).toThrow(/JSON/i);
  });
  it("only imports names and flags from realistic appsettings, env and CLI secrets", () => {
    const password = "Fake-password-7!";
    const connection = "Server=db.example;Database=orders;User Id=svc;Password=Fake-password-7!";
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXN2YyJ9.fake_signature_0123456789";
    for (const text of [
      JSON.stringify({ Password: password, ConnectionStrings: { Orders: connection }, Auth: { Token: token } }),
      `Password=${password}\nConnectionStrings:Orders=${connection}\nAuth:Token=${token}`,
      JSON.stringify([
        { key: "Password", value: password },
        { key: "ConnectionStrings:Orders", value: connection },
        { key: "Auth:Token", value: token },
      ]),
    ]) {
      expect(parseSettings(text)).toEqual([
        { key: "Password" },
        { key: "ConnectionStrings:Orders" },
        { key: "Auth:Token" },
      ]);
    }
    for (const text of [
      connection,
      token,
      `Bearer ${token}`,
      JSON.stringify([{ key: connection, value: password }]),
      JSON.stringify({ Auth: { [token]: password } }),
    ]) {
      expect(parseSettings(text)).toEqual([]);
    }
  });
  it("losslessly edits every accepted literal key while paste still recognizes assignments", () => {
    const keys = [
      "Feature Flag",
      "A=B",
      "!Literal",
      'A"B',
      "[lock]Key",
      "#Key",
      "//Key",
      "Line\nBreak",
      "Back\\slash",
      "B:C",
    ];
    const settings = keys.map((key, i) => ({ key, ...(i % 2 ? { secret: true as const } : {}) }));
    expect(parseSettingsEditor(settingsText(settings))).toEqual(settings);
    expect(parseSettingsEditor("Feature Flag\nA=B")).toEqual([{ key: "Feature Flag" }, { key: "A=B" }]);
    expect(parseSettings("A=Fake-password-7!")).toEqual([{ key: "A" }]);
  });
  it("normalizes flow semantics and invalidates an edge signature on relation changes", () => {
    const edge = { id: "e", from: "a", to: "b" };
    expect(edgeSemanticSignature(edge)).toEqual(edgeSemanticSignature({ ...edge, kind: "async", relation: "flow" }));
    expect(edgeSemanticSignature(edge)).not.toEqual(edgeSemanticSignature({ ...edge, relation: "secret" }));
  });
});
