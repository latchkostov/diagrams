import { diagnostic, diagnosticKey, type ImportText } from "./graph";
import { t as tr } from "../../i18n";
import type { EdgeRelation } from "../../model/types";
import { sanitizeSettings } from "../../model/relations";
import { inferRelation } from "../../stencils/relations";
import { getStencil } from "../../stencils/registry";
import type { Evidence, ImportComponent, ImportGraph } from "./graph";
import { Components, Links } from "./links";
import { ignoredHost, isOutsideHost, parseUrl, productOf } from "./settings";
import { configPath, newRefBudget, TF_LIMITS, TfConfig, type RefBudget, type Refs } from "./tfRefs";
import { BoundedIndex } from "./tfIndex";
import { GLUE, guessOf, nameAttr, notDrawnReason, stencilOf, toneOf } from "./tfTypes";
import {
  acaHasScaling,
  acaScaling,
  appServiceScaling,
  cloudRunHasScaling,
  cloudRunV1Scaling,
  cloudRunV2Scaling,
  ecsScaling,
  ScalingUnsupported,
  TF_SCALING_LIMITS,
  unsupported,
  type AlbResolver,
  type ScalingResult,
} from "./tfScaling";
import { scalingReasonCode } from "../../model/scalingReason";
import { ImportError, isMap, own, str } from "./yaml";

// Terraform plan or state JSON (`terraform show -json`) → ImportGraph (docs/research/imports.md § Mapping:
// Terraform). Only that output is read: HCL isn't parsed, and a binary plan or a raw state file says how to get
// the JSON. Resources on the type table are drawn; subscriptions, event-source mappings and targets are flows
// between them; references in the plan's `configuration` are dependencies (identity, secret and config by the
// target's stencil); IAM grants and Azure role assignments give identity, secret and flow relationships where
// they're clear. ECS Application Auto Scaling (with its CloudWatch alarms), Azure Monitor autoscale on an App
// Service plan, and the scaling blocks of Container Apps and Cloud Run become the scaled node's autoscaling policy
// (tfScaling.ts). Everything else is listed in the report, grouped by type.
//
// Values are untrusted and mostly private. Only a whitelist of attributes is read (names, ARNs and ids to match
// resources, an engine, a schedule, a protocol), never one marked sensitive (`sensitive_values`), and never a
// variable, an output or an expression's `constant_value`. Names and outside host names can reach the diagram;
// ARNs, ids and every other value are used in memory to join resources, then dropped.

export interface SourceFile {
  name: string;
  text: string;
}

/** At most this many resource instances in one import. */
export const MAX_RESOURCES = 10_000;
/** Instances of one resource read for matching (the node is "×N" however many there are). */
const MAX_INSTANCES_READ = 100;
/** Strings read from one attribute of one instance. */
const MAX_STRINGS = 50;
const MAX_VALUE = 2_048;

export const TERRAFORM_SOURCE =
  "Terraform source (.tf) isn't read. Run “terraform show -json plan.out” (or state) and import that.";
export const TERRAFORM_BINARY =
  "Terraform plan files are binary. Run “terraform show -json plan.out > plan.json” and import that.";
export const TERRAFORM_RAW_STATE =
  "This is a raw Terraform state file, which isn't read. Run “terraform show -json” and import its output.";

interface Instance {
  values: unknown;
  sensitive: unknown;
}

interface Resource {
  /** `file\u0001module path\u0001local address`. */
  key: string;
  file: number;
  /** "", "module.orders", "module.orders.module.queues". */
  module: string;
  mode: "managed" | "data";
  type: string;
  name: string;
  /** "aws_sqs_queue.orders", "data.aws_iam_policy_document.x". */
  local: string;
  instances: Instance[];
  count: number;
  refs?: Refs;
}

const IDENT = /^[A-Za-z_][\w-]{0,127}$/;
const TYPE = /^[a-z][a-z0-9_]{0,127}$/;
const label = (s: string) => s.slice(0, 120);
const is =
  (...types: string[]) =>
  (r: Resource) =>
    types.includes(r.type);
/** Azure ids are case-insensitive; everything else matches exactly. */
const norm = (v: string) => (v.startsWith("/") ? v.toLowerCase().replace(/\/+$/, "") : v);
/** A Lambda ARN with a version or alias → the function's ARN. */
const lambdaArn = (v: string) => {
  const embedded = /\/functions\/(arn:[^/]{1,512})\/invocations$/.exec(v)?.[1];
  const arn = embedded ?? v;
  return /^arn:aws[\w-]*:lambda:/.test(arn) ? [arn.split(":").slice(0, 7).join(":"), v] : [v];
};
/** A name that can be a label: short, one line, not a URL, an address or anything credential-shaped. */
const safeName = (s: string) =>
  s.trim().length > 0 && s.length <= 120 && !/\p{Cc}|:\/\/|@/u.test(s) && !!sanitizeSettings([{ key: s }]);

/** One attribute's strings from an instance's values (`path` through nested blocks), never a sensitive one. */
function strings(inst: Instance, path: readonly string[]): string[] {
  const out: string[] = [];
  const stack: [unknown, unknown, number][] = [[inst.values, inst.sensitive, 0]];
  for (let visits = 0; stack.length && out.length < MAX_STRINGS && visits < 10_000; visits++) {
    const [v, s, i] = stack.pop()!;
    if (s === true || v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      for (let j = Math.min(v.length, MAX_STRINGS) - 1; j >= 0; j--)
        stack.push([v[j], Array.isArray(s) ? s[j] : undefined, i]);
    } else if (i === path.length) {
      if (typeof v === "string" && v.length <= MAX_VALUE) out.push(v);
    } else stack.push([own(v, path[i]), own(s, path[i]), i + 1]);
  }
  return out;
}

/** The report's summary line names supporting resources by these kinds (else "parts of what's drawn"). */
const reasonKinds = () =>
  new Map<string, ImportText>([
    ["importReason.helperNotInfrastructure", diagnostic("importKind.helpers")],
    ["importReason.accessAndPermissions", diagnostic("importKind.accessAndPermissions")],
    ["importReason.networking", diagnostic("importKind.networking")],
    ["importReason.monitoring", diagnostic("importKind.monitoring")],
    ["importDetail.dataSource", diagnostic("importKind.dataSources")],
    ["importReason.connectsNothingInTheseFiles", diagnostic("importKind.connectionsWithNoEndsHere")],
    ["importDetail.terraformTypeNotDrawn", diagnostic("importKind.otherTypes")],
  ]);

/** A path no value has: `targets` reads only the configuration's references. */
const REFS_ONLY: readonly string[] = ["\u0000"];

/** Adds to a map of lists in place (a copy per item would be quadratic for a resource used thousands of times). */
function append<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const first = (r: Resource, path: readonly string[]) =>
  r.instances.length ? strings(r.instances[0], path)[0] : undefined;

/** The file as Terraform JSON, or an error that says what to run instead. */
function parse(f: SourceFile): Record<string, unknown> {
  const text = f.text.charCodeAt(0) === 0xfeff ? f.text.slice(1) : f.text;
  if (text.startsWith("PK\u0003\u0004")) throw new ImportError(TERRAFORM_BINARY);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ImportError(tr("importDetail.value0IsntValidJSONSoIt", { value0: f.name }));
  }
  if (!isMap(doc)) throw new ImportError(tr("importDetail.value0IsntTerraformJSON", { value0: f.name }));
  const version = own(doc, "format_version");
  if (version === undefined && own(doc, "lineage") !== undefined) throw new ImportError(TERRAFORM_RAW_STATE);
  if (typeof version !== "string" || !/^1(\.|$)/.test(version))
    throw new ImportError(
      tr("importDetail.value0IsTerraformJSONFormatValue1", {
        value0: f.name,
        value1: typeof version === "string" ? version.slice(0, 12) : "(none)",
      }),
    );
  return doc;
}

export function readTerraform(files: readonly SourceFile[], options: { everything?: boolean } = {}): ImportGraph {
  const kindsByReason = reasonKinds();
  const everything = !!options.everything;
  const g: ImportGraph = {
    format: "Terraform",
    title: "",
    source: files.map((f) => f.name.replace(/^.*[\\/]/, "")).join(", "),
    components: [],
    links: [],
    groups: [],
    notDrawn: [],
    unread: [],
    notes: [],
    connectionsTitle: diagnostic("importDetail.connectionsFromSubscriptionsMappingsAndGrants"),
  };
  const note = (text: ImportText) => {
    if (!g.notes.some((n) => diagnosticKey(n) === diagnosticKey(text)) && g.notes.length < 200) g.notes.push(text);
  };
  const unread = (name: string, reason: ImportText) => {
    if (g.unread.length < 10_000) g.unread.push({ name, reason });
  };
  const budget: RefBudget = newRefBudget();

  // ------------------------------------------------ resources from every file, instances folded
  const byKey = new Map<string, Resource>();
  const configs: (TfConfig | undefined)[] = [];
  const kinds = new Set<"plan" | "state">();
  const changes = { add: 0, change: 0, destroy: 0 };
  const destroyed = new Map<string, { type: string; name: string }>();
  let instances = 0;
  files.forEach((f, file) => {
    const doc = parse({ name: f.name.replace(/^.*[\\/]/, ""), text: f.text });
    const plan = ["planned_values", "resource_changes", "configuration"].some((k) => own(doc, k) !== undefined);
    kinds.add(plan ? "plan" : "state");
    const root = own(own(doc, plan ? "planned_values" : "values"), "root_module");
    const stack: [unknown, string, number][] = [[root, "", 0]];
    while (stack.length) {
      const [mod, path, depth] = stack.pop()!;
      if (!isMap(mod)) continue;
      if (depth > TF_LIMITS.maxModuleDepth) {
        unread(
          label(path),
          diagnostic("importDetail.modulesNestedMoreThanValue0Deep", { value0: TF_LIMITS.maxModuleDepth }),
        );
        continue;
      }
      const resources = own(mod, "resources");
      for (const r of Array.isArray(resources) ? resources : []) {
        const type = str(own(r, "type")) ?? "";
        const name = str(own(r, "name")) ?? "";
        const mode = own(r, "mode") === "data" ? "data" : "managed";
        if (!TYPE.test(type) || !IDENT.test(name)) {
          unread(label(str(own(r, "address")) ?? "a resource"), diagnostic("importDetail.noTypeOrName"));
          continue;
        }
        if (++instances > MAX_RESOURCES)
          throw new ImportError(tr("importDetail.theseFilesHoldMoreThanValue0More", { value0: MAX_RESOURCES }));
        const local = `${mode === "data" ? "data." : ""}${type}.${name}`;
        const key = `${file}\u0001${path}\u0001${local}`;
        let res = byKey.get(key);
        if (!res) {
          res = { key, file, module: path, mode, type, name, local, instances: [], count: 0 };
          byKey.set(key, res);
        }
        res.count++;
        if (res.instances.length < MAX_INSTANCES_READ)
          res.instances.push({ values: own(r, "values"), sensitive: own(r, "sensitive_values") });
      }
      const children = own(mod, "child_modules");
      for (const child of Array.isArray(children) ? children.slice(0, 10_000) : []) {
        const address = str(own(child, "address"));
        const childPath = address && address.length <= 1_024 ? configPath(address) : "";
        if (!/^module\.[\w-]+(\.module\.[\w-]+)*$/.test(childPath)) continue;
        stack.push([child, childPath, depth + 1]);
      }
    }
    if (plan) {
      const rc = own(doc, "resource_changes");
      for (const c of Array.isArray(rc) ? rc.slice(0, MAX_RESOURCES * 2) : []) {
        const actions = own(own(c, "change"), "actions");
        const a = Array.isArray(actions) ? actions.filter((x): x is string => typeof x === "string") : [];
        const creates = a.includes("create");
        const deletes = a.includes("delete");
        if (creates) changes.add++;
        if (deletes) changes.destroy++;
        if (a.includes("update")) changes.change++;
        const type = str(own(c, "type")) ?? "";
        const name = str(own(c, "name")) ?? "";
        if (deletes && !creates && TYPE.test(type) && IDENT.test(name) && own(c, "mode") !== "data") {
          const module = configPath(str(own(c, "module_address")) ?? "");
          destroyed.set(`${file}\u0001${module}\u0001${type}.${name}`, { type, name });
        }
      }
      const configuration = own(doc, "configuration");
      if (isMap(configuration)) {
        const config = new TfConfig(configuration, budget);
        for (const path of config.tooDeep)
          unread(
            label(path),
            diagnostic("importDetail.modulesNestedMoreThanValue0Deep", { value0: TF_LIMITS.maxModuleDepth }),
          );
        configs[file] = config;
      }
    }
  });
  for (const r of byKey.values()) r.refs = configs[r.file]?.refsOf(r.module, r.local);
  const resources = [...byKey.values()];
  if (!resources.length && !destroyed.size) throw new ImportError(tr("importDetail.theresNothingToDrawNoTerraform"));
  g.format = kinds.size === 1 ? (kinds.has("plan") ? "Terraform plan" : "Terraform state") : "Terraform";

  // ------------------------------------------------ indexes: identity values → resources (in memory only)
  // A value shared by more than 50 resources identifies none, and a name more than one (BoundedIndex).
  const index = new BoundedIndex<Resource>(50);
  const names = new BoundedIndex<Resource>(1);
  const principals = new BoundedIndex<Resource>(50);
  const hosts = new BoundedIndex<Resource>(50);
  /** EventBridge rules by file, bus and name: a rule's name is unique on its bus, not in the account. */
  const ruleIndex = new BoundedIndex<Resource>(1);
  const busOf = (v: string | undefined) => (v ? v.slice(v.lastIndexOf("/") + 1) : "") || "default";
  const EXTRA = new Map<string, string[][]>([
    ["aws_lambda_function", [["invoke_arn"], ["qualified_arn"]]],
    ["aws_dynamodb_table", [["stream_arn"]]],
    ["aws_sqs_queue", [["url"]]],
  ]);
  for (const r of resources)
    for (const inst of r.instances) {
      for (const path of [["arn"], ["id"], ...(EXTRA.get(r.type) ?? [])])
        for (const v of strings(inst, path)) index.add(norm(v), r);
      for (const v of strings(inst, [nameAttr(r.type)])) names.add(`${r.file}\u0001${r.type}\u0001${v}`, r);
      if (r.type === "aws_cloudwatch_event_rule")
        for (const v of strings(inst, ["name"]))
          ruleIndex.add(`${r.file}\u0001${busOf(strings(inst, ["event_bus_name"])[0])}\u0001${v}`, r);
      for (const v of [
        ...strings(inst, ["identity", "principal_id"]),
        ...(r.type === "azurerm_user_assigned_identity" ? strings(inst, ["principal_id"]) : []),
      ])
        principals.add(v.toLowerCase(), r);
      for (const v of [...strings(inst, ["uri"]), ...strings(inst, ["status", "url"])]) {
        const host = parseUrl(v)?.hosts[0];
        if (host) hosts.add(host, r);
      }
    }
  const byValue = (value: string, ok: (r: Resource) => boolean) => index.get(norm(value)).filter(ok);
  /** By name, within one file: a name that matches more than one resource joins nothing (scoped, never guessed). */
  const byName = (file: number, types: string[], name: string) => {
    const found = types.flatMap((t) => names.get(`${file}\u0001${t}\u0001${name}`));
    return found.length === 1 ? found : [];
  };

  /**
   * Work done expanding references and values into targets, for the whole import. A cached resolution costs
   * nothing to find but its targets still cost something to visit: this counts them, so repeated references to a
   * large module output can't freeze the tab.
   */
  let work = 0;
  const spend = (n: number) => {
    work += n;
    if (work <= TF_LIMITS.maxWork) return true;
    budget.exhausted = true;
    return false;
  };

  /**
   * What an attribute of `r` points at: its references in the plan's configuration (followed through modules), else
   * its values matched against other resources' ARNs and ids. `ok` says which resources it may name.
   */
  const targets = (
    r: Resource,
    attr: string,
    path: readonly string[],
    ok: (t: Resource) => boolean,
    transform: (v: string) => string[] = (v) => [v],
  ): Resource[] => {
    const out = new Set<Resource>();
    const config = configs[r.file];
    for (const ref of new Set(r.refs?.get(attr))) {
      const keys = config?.resolve(r.module, ref) ?? [];
      if (!spend(keys.length + 1)) break;
      for (const k of keys) {
        const t = byKey.get(`${r.file}\u0001${k}`);
        if (t && t !== r && ok(t)) out.add(t);
      }
    }
    if (!out.size)
      for (const inst of r.instances)
        for (const v of strings(inst, path))
          for (const x of transform(v)) {
            const found = byValue(x, ok);
            if (!spend(found.length + 1)) return [...out];
            for (const t of found) out.add(t);
          }
    return [...out];
  };

  // ------------------------------------------------ what is drawn
  const components = new Components(g.components);
  const links = new Links(components);
  const drawn = (r: Resource) => components.has(r.key);
  const used = new Set<Resource>();
  /** Drawn only by Draw everything: a policy, a secret's version, a password, a network. */
  const extras = new Set<Resource>();
  /** Not drawn, grouped by type and reason. */
  const skipped = new Map<string, { type: string; reason: ImportText; names: string[] }>();
  const skip = (type: string, name: string, reason: ImportText) => {
    const k = `${type}\u0001${diagnosticKey(reason)}`;
    const entry = skipped.get(k) ?? { type, reason, names: [] };
    entry.names.push(name);
    skipped.set(k, entry);
  };
  const addressOf = (r: Resource) => (r.module ? `${r.module}.${r.local}` : r.local);
  const labelFor = (r: Resource) => {
    const values = new Set(r.instances.map((i) => strings(i, [nameAttr(r.type)])[0]));
    const only = values.size === 1 ? [...values][0] : undefined;
    return label(only && safeName(only) ? only.trim() : r.name);
  };
  /** A resource as a node: count and for_each instances are one node, "×3". */
  const draw = (r: Resource, stencil: string, extra: Partial<ImportComponent> & { note?: string } = {}) => {
    const { note: what, ...rest } = extra;
    const sub = [what, r.count > 1 ? `×${r.count.toLocaleString("en")}` : "", r.mode === "data" ? "data source" : ""]
      .filter(Boolean)
      .join(" · ");
    components.add({
      key: r.key,
      label: labelFor(r),
      ...(sub ? { sublabel: sub } : {}),
      hint: { name: r.name },
      stencil,
      ...(r.module ? { context: r.module } : {}),
      ...rest,
    });
  };
  const engine = (r: Resource) => first(r, ["engine"]);
  for (const r of resources) {
    const stencil = stencilOf(r.type, engine(r));
    if (stencil) {
      draw(r, stencil);
      continue;
    }
    if (r.mode === "data") {
      skip(`data.${r.type}`, r.name, diagnostic("importDetail.dataSource"));
      continue;
    }
    if (everything && !(r.type === "aws_cloudwatch_event_rule" && first(r, ["schedule_expression"]))) {
      draw(r, guessOf(r.type)?.stencil ?? "generic.service", { note: r.type });
      extras.add(r);
      if (GLUE.has(r.type)) used.add(r);
      continue;
    }
    if (GLUE.has(r.type)) continue;
    const reason = notDrawnReason(r.type);
    if (reason) skip(r.type, r.name, reason);
    else {
      const guess = guessOf(r.type)!;
      draw(r, guess.stencil, { guess: { evidence: r.type, alternatives: guess.alternatives } });
    }
  }

  const resourceEvidence = (r: Resource, extra: Partial<Evidence> = {}): Evidence => ({
    source: "resource",
    name: addressOf(r).slice(0, 200),
    ...extra,
  });
  /** A reference's relationship: the target's own (Identity, Secret, Config, Telemetry), else Depends on. */
  const relationTo = (from: string, to: string): EdgeRelation => {
    const rel = inferRelation(components.stencilOf(from), components.stencilOf(to));
    return rel === "flow" ? "depends" : rel;
  };
  const flowAll = (
    from: string[],
    to: string[],
    kind: "async" | "sync",
    evidence: Evidence,
    props?: Record<string, unknown>,
  ) => {
    for (const a of from) for (const b of to) if (a !== b) links.flow(a, b, kind, evidence, props);
  };
  const keys = (rs: Resource[]) => rs.filter(drawn).map((r) => r.key);
  /** An outside endpoint (an HTTPS subscription, a push endpoint): its host only, never the URL. */
  const outside = (url: string | undefined): string[] => {
    const parsed = url ? parseUrl(url) : undefined;
    const host = parsed && /^https?$/.test(parsed.scheme) ? parsed.hosts[0] : undefined;
    if (!host || ignoredHost(host) || !isOutsideHost(host)) return [];
    const served = hosts.get(host).filter(drawn);
    if (served.length) return served.map((r) => r.key);
    return [
      components.add({
        key: `\u0003${host}`,
        label: host,
        hint: { name: host },
        stencil: productOf(host) ?? "generic.external-api",
      }),
    ];
  };
  /** A drawn resource messages can flow to: not an identity, a secret or a config store. */
  const DRAWN = (t: Resource) => drawn(t) && relationTo("", t.key) === "depends";

  // ------------------------------------------------ EventBridge: rules on a bus, scheduled rules, targets
  /** A rule's node: its bus (the default bus when it names none), or itself when it runs on a schedule. */
  const ruleNode = new Map<Resource, () => string | undefined>();
  /** A bus the rule names but the files don't hold: the default bus, or one named by its last ARN segment. */
  const busNamed = (file: number, name: string) => {
    const short = name.slice(name.lastIndexOf("/") + 1);
    const label = safeName(short) ? short : "default";
    return components.add({
      key: `${file}\u0001\u0005bus\u0001${label}`,
      label,
      sublabel: label === "default" ? "event bus" : "not in these files",
      hint: { name: label },
      stencil: "aws.eventbridge",
    });
  };
  for (const rule of resources.filter(is("aws_cloudwatch_event_rule"))) {
    const schedule = first(rule, ["schedule_expression"]);
    if (schedule) {
      draw(rule, "generic.scheduler", { note: schedule.slice(0, 60) });
      ruleNode.set(rule, () => rule.key);
      continue;
    }
    if (drawn(rule)) {
      ruleNode.set(rule, () => rule.key);
      continue;
    }
    const bus = keys(targets(rule, "event_bus_name", ["event_bus_name"], is("aws_cloudwatch_event_bus")));
    const named = first(rule, ["event_bus_name"]);
    const busKey =
      bus[0] ??
      (named && named !== "default" ? keys(byName(rule.file, ["aws_cloudwatch_event_bus"], named))[0] : undefined);
    ruleNode.set(rule, () => {
      used.add(rule);
      return busKey ?? busNamed(rule.file, named ?? "default");
    });
  }
  for (const t of resources.filter(is("aws_cloudwatch_event_target"))) {
    // A plan's reference names the rule; a state names it by bus and name (a rule's id is only unique per bus).
    const ruleName = first(t, ["rule"]);
    const rule =
      targets(t, "rule", REFS_ONLY, is("aws_cloudwatch_event_rule"))[0] ??
      (ruleName
        ? ruleIndex.get(`${t.file}\u0001${busOf(first(t, ["event_bus_name"]))}\u0001${ruleName}`)[0]
        : undefined);
    const to = keys(targets(t, "arn", ["arn"], DRAWN, lambdaArn));
    const from = rule && to.length ? ruleNode.get(rule)?.() : undefined;
    if (from) {
      flowAll([from], to, "async", resourceEvidence(t));
      used.add(t);
    }
  }

  // ------------------------------------------------ AWS glue: subscriptions, mappings, notifications
  for (const s of resources.filter(is("aws_sns_topic_subscription"))) {
    const topics = keys(targets(s, "topic_arn", ["topic_arn"], is("aws_sns_topic")));
    const protocol = (first(s, ["protocol"]) ?? "").toLowerCase();
    if (/^(email|email-json|sms|application)$/.test(protocol)) {
      skip(s.type, s.name, diagnostic("importDetail.anEmailSMSOrAppSubscription"));
      used.add(s);
      continue;
    }
    let ends = keys(
      targets(
        s,
        "endpoint",
        ["endpoint"],
        protocol === "sqs"
          ? is("aws_sqs_queue")
          : protocol === "lambda"
            ? is("aws_lambda_function")
            : is("aws_sqs_queue", "aws_lambda_function", "aws_kinesis_firehose_delivery_stream"),
        lambdaArn,
      ),
    );
    if (!ends.length && /^https?$/.test(protocol)) ends = outside(first(s, ["endpoint"]));
    if (topics.length && ends.length) {
      flowAll(topics, ends, "async", resourceEvidence(s));
      used.add(s);
    }
  }
  const STREAMS = is(
    "aws_sqs_queue",
    "aws_kinesis_stream",
    "aws_msk_cluster",
    "aws_msk_serverless_cluster",
    "aws_dynamodb_table",
    "aws_mq_broker",
  );
  for (const m of resources.filter(is("aws_lambda_event_source_mapping"))) {
    const sources = keys(targets(m, "event_source_arn", ["event_source_arn"], STREAMS));
    let fns = keys(targets(m, "function_name", ["function_name"], is("aws_lambda_function"), lambdaArn));
    const fnName = first(m, ["function_name"]);
    if (!fns.length && fnName && !fnName.startsWith("arn:"))
      fns = keys(byName(m.file, ["aws_lambda_function"], fnName));
    const group = first(m, ["amazon_managed_kafka_event_source_config", "consumer_group_id"]);
    if (sources.length && fns.length) {
      flowAll(
        sources,
        fns,
        "async",
        resourceEvidence(m),
        group && /^[\w.-]{1,200}$/.test(group) ? { group } : undefined,
      );
      used.add(m);
    }
  }
  for (const n of resources.filter(is("aws_s3_bucket_notification"))) {
    const buckets = keys(targets(n, "bucket", ["bucket"], is("aws_s3_bucket")));
    const ends = [
      ...keys(targets(n, "queue", ["queue", "queue_arn"], is("aws_sqs_queue"))),
      ...keys(targets(n, "topic", ["topic", "topic_arn"], is("aws_sns_topic"))),
      ...keys(
        targets(n, "lambda_function", ["lambda_function", "lambda_function_arn"], is("aws_lambda_function"), lambdaArn),
      ),
    ];
    if (buckets.length && ends.length) {
      flowAll(buckets, ends, "async", resourceEvidence(n));
      used.add(n);
    }
  }
  // Dead letters: a queue's redrive policy (inline or its own resource) and a function's dead-letter target.
  const deadLetters = (r: Resource, from: string[], attr: string) => {
    let dlq = keys(targets(r, attr, REFS_ONLY, is("aws_sqs_queue", "aws_sns_topic")));
    if (!dlq.length)
      for (const inst of r.instances)
        for (const policy of strings(inst, [attr])) {
          let arn: unknown;
          try {
            arn = own(JSON.parse(policy), "deadLetterTargetArn");
          } catch {
            arn = undefined;
          }
          if (typeof arn === "string") dlq.push(...keys(byValue(arn, is("aws_sqs_queue"))));
        }
    dlq = [...new Set(dlq)];
    if (from.length && dlq.length)
      flowAll(from, dlq, "async", resourceEvidence(r, { note: "dead letters" }), { dlq: true });
    return dlq.length > 0;
  };
  for (const q of resources.filter(is("aws_sqs_queue"))) deadLetters(q, keys([q]), "redrive_policy");
  for (const p of resources.filter(is("aws_sqs_queue_redrive_policy"))) {
    const queues = keys(targets(p, "queue_url", ["queue_url"], is("aws_sqs_queue")));
    if (queues.length && deadLetters(p, queues, "redrive_policy")) used.add(p);
  }
  for (const fn of resources.filter(is("aws_lambda_function"))) {
    const dlq = keys(
      targets(fn, "dead_letter_config", ["dead_letter_config", "target_arn"], is("aws_sqs_queue", "aws_sns_topic")),
    );
    if (drawn(fn) && dlq.length)
      flowAll([fn.key], dlq, "async", resourceEvidence(fn, { note: "dead letters" }), { dlq: true });
  }

  // ------------------------------------------------ load balancers and API gateways → their targets
  const LBS = is("aws_lb", "aws_alb");
  const TGS = is("aws_lb_target_group", "aws_alb_target_group");
  const LISTENERS = is("aws_lb_listener", "aws_alb_listener");
  const tgLbs = new Map<Resource, Set<string>>();
  const tgTargets = new Map<Resource, Set<string>>();
  const tgUses = new Map<Resource, Resource[]>();
  const addTo = (m: Map<Resource, Set<string>>, k: Resource, vs: string[]) => {
    const set = m.get(k) ?? new Set<string>();
    for (const v of vs) set.add(v);
    m.set(k, set);
  };
  const listenerLbs = new Map<Resource, string[]>();
  for (const l of resources.filter(LISTENERS)) {
    const lbs = keys(targets(l, "load_balancer_arn", ["load_balancer_arn"], LBS));
    listenerLbs.set(l, lbs);
    for (const tg of [
      ...targets(l, "default_action", ["default_action", "target_group_arn"], TGS),
      ...targets(l, "default_action", ["default_action", "forward", "target_group", "arn"], TGS),
    ]) {
      addTo(tgLbs, tg, lbs);
      append(tgUses, tg, l);
    }
  }
  for (const rule of resources.filter(is("aws_lb_listener_rule", "aws_alb_listener_rule"))) {
    const lbs = targets(rule, "listener_arn", ["listener_arn"], LISTENERS).flatMap((l) => listenerLbs.get(l) ?? []);
    for (const tg of [
      ...targets(rule, "action", ["action", "target_group_arn"], TGS),
      ...targets(rule, "action", ["action", "forward", "target_group", "arn"], TGS),
    ]) {
      addTo(tgLbs, tg, lbs);
      append(tgUses, tg, rule);
    }
  }
  for (const a of resources.filter(is("aws_lb_target_group_attachment", "aws_alb_target_group_attachment")))
    for (const tg of targets(a, "target_group_arn", ["target_group_arn"], TGS)) {
      addTo(tgTargets, tg, keys(targets(a, "target_id", ["target_id"], DRAWN, lambdaArn)));
      append(tgUses, tg, a);
    }
  for (const svc of resources.filter(is("aws_ecs_service")))
    for (const tg of targets(svc, "load_balancer", ["load_balancer", "target_group_arn"], TGS))
      addTo(tgTargets, tg, keys([svc]));
  for (const [tg, lbs] of tgLbs) {
    const to = [...(tgTargets.get(tg) ?? [])];
    if (!lbs.size || !to.length) continue;
    flowAll([...lbs], to, "sync", resourceEvidence(tg));
    for (const r of [tg, ...(tgUses.get(tg) ?? [])]) used.add(r);
  }
  for (const i of resources.filter(is("aws_api_gateway_integration", "aws_apigatewayv2_integration"))) {
    const v2 = i.type === "aws_apigatewayv2_integration";
    const apis = keys(
      targets(
        i,
        v2 ? "api_id" : "rest_api_id",
        [v2 ? "api_id" : "rest_api_id"],
        is(v2 ? "aws_apigatewayv2_api" : "aws_api_gateway_rest_api"),
      ),
    );
    const attr = v2 ? "integration_uri" : "uri";
    let to = keys(targets(i, attr, [attr], (t) => drawn(t) && !TGS(t), lambdaArn));
    if (!to.length) to = targets(i, attr, [attr], LISTENERS).flatMap((l) => listenerLbs.get(l) ?? []);
    if (!to.length) to = outside(first(i, [attr]));
    if (apis.length && to.length) {
      flowAll(apis, to, "sync", resourceEvidence(i));
      used.add(i);
    }
  }

  // ------------------------------------------------ Azure: Service Bus, Event Grid
  /** A Service Bus entity named in the same namespace as `sibling` (an id ending /topics/x or /queues/x). */
  const inNamespace = (siblings: Resource[], name: string): Resource[] => {
    const out: Resource[] = [];
    for (const s of siblings) {
      const id = first(s, ["id"]) ?? first(s, ["namespace_id"]);
      const ns = id && /^(.*\/namespaces\/[^/]+)(\/|$)/i.exec(id)?.[1];
      if (ns)
        for (const kind of ["queues", "topics"])
          out.push(...byValue(`${ns}/${kind}/${name}`, is("azurerm_servicebus_queue", "azurerm_servicebus_topic")));
    }
    return out;
  };
  const SB = is("azurerm_servicebus_queue", "azurerm_servicebus_topic");
  const forwards = (r: Resource, attr: string, scope: Resource[]) => {
    const found = targets(r, attr, REFS_ONLY, SB);
    if (found.length) return keys(found);
    const name = first(r, [attr]);
    return name && /^[\w.~/-]{1,260}$/.test(name) ? keys(inNamespace(scope, name)) : [];
  };
  for (const s of resources.filter(is("azurerm_servicebus_subscription"))) {
    const topics = targets(s, "topic_id", ["topic_id"], is("azurerm_servicebus_topic"));
    const subName = first(s, ["name"]);
    const group = subName && /^[\w.~-]{1,50}$/.test(subName) ? { group: subName } : undefined;
    const to = forwards(s, "forward_to", topics);
    const dead = forwards(s, "forward_dead_lettered_messages_to", topics);
    if (topics.length && to.length) flowAll(keys(topics), to, "async", resourceEvidence(s), group);
    if (topics.length && dead.length)
      flowAll(keys(topics), dead, "async", resourceEvidence(s, { note: "dead letters" }), { dlq: true });
    if (topics.length && (to.length || dead.length)) used.add(s);
  }
  for (const q of resources.filter(is("azurerm_servicebus_queue"))) {
    const to = forwards(q, "forward_to", [q]);
    if (drawn(q) && to.length) flowAll([q.key], to, "async", resourceEvidence(q));
  }
  /** Event Grid delivery: a function, a queue, an event hub, a webhook. */
  const endpoints = (s: Resource): string[] => [
    ...keys(
      targets(s, "azure_function_endpoint", ["azure_function_endpoint", "function_id"], DRAWN, (v) => [
        v.replace(/\/functions\/[^/]+$/i, ""),
        v,
      ]),
    ),
    ...keys(targets(s, "service_bus_queue_endpoint_id", ["service_bus_queue_endpoint_id"], DRAWN)),
    ...keys(targets(s, "service_bus_topic_endpoint_id", ["service_bus_topic_endpoint_id"], DRAWN)),
    ...keys(targets(s, "eventhub_endpoint_id", ["eventhub_endpoint_id"], DRAWN)),
    ...(() => {
      const queue = first(s, ["storage_queue_endpoint", "queue_name"]);
      const byRef = keys(targets(s, "storage_queue_endpoint", REFS_ONLY, is("azurerm_storage_queue")));
      return byRef.length ? byRef : queue ? keys(byName(s.file, ["azurerm_storage_queue"], queue)) : [];
    })(),
    ...(() => {
      const hook = keys(targets(s, "webhook_endpoint", REFS_ONLY, DRAWN));
      return hook.length ? hook : outside(first(s, ["webhook_endpoint", "url"]));
    })(),
  ];
  for (const t of resources.filter(is("azurerm_eventgrid_system_topic"))) {
    const sources = keys([
      ...targets(t, "source_arm_resource_id", ["source_arm_resource_id"], DRAWN),
      ...targets(t, "source_resource_id", ["source_resource_id"], DRAWN),
    ]);
    if (drawn(t)) flowAll(sources, [t.key], "async", resourceEvidence(t));
  }
  for (const s of resources.filter(
    is("azurerm_eventgrid_event_subscription", "azurerm_eventgrid_system_topic_event_subscription"),
  )) {
    let from: string[];
    if (s.type === "azurerm_eventgrid_event_subscription") from = keys(targets(s, "scope", ["scope"], DRAWN));
    else {
      from = keys(targets(s, "system_topic", REFS_ONLY, is("azurerm_eventgrid_system_topic")));
      const name = first(s, ["system_topic"]);
      if (!from.length && name) from = keys(byName(s.file, ["azurerm_eventgrid_system_topic"], name));
    }
    const to = endpoints(s);
    if (from.length && to.length) {
      flowAll(from, to, "async", resourceEvidence(s));
      used.add(s);
    }
  }

  // ------------------------------------------------ Google Cloud: Pub/Sub, triggers, schedulers
  const TOPICS = is("google_pubsub_topic");
  const topicOf = (r: Resource, attr: string, path: readonly string[]) => {
    const found = keys(targets(r, attr, path, TOPICS));
    if (found.length) return found;
    const v = first(r, path);
    return v ? keys(byName(r.file, ["google_pubsub_topic"], v.replace(/^.*\/topics\//, ""))) : [];
  };
  for (const s of resources.filter(is("google_pubsub_subscription"))) {
    const topics = topicOf(s, "topic", ["topic"]);
    const subName = first(s, ["name"]);
    const group = subName && /^[\w.~%+-]{1,255}$/.test(subName) ? { group: subName } : undefined;
    let push = keys(targets(s, "push_config", REFS_ONLY, DRAWN));
    if (!push.length) push = outside(first(s, ["push_config", "push_endpoint"]));
    const storage = keys(
      targets(s, "cloud_storage_config", ["cloud_storage_config", "bucket"], is("google_storage_bucket")),
    );
    const dead = topicOf(s, "dead_letter_policy", ["dead_letter_policy", "dead_letter_topic"]);
    if (!topics.length) continue;
    if (push.length || storage.length) flowAll(topics, [...push, ...storage], "async", resourceEvidence(s), group);
    if (dead.length) flowAll(topics, dead, "async", resourceEvidence(s, { note: "dead letters" }), { dlq: true });
    if (push.length || storage.length || dead.length) used.add(s);
  }
  for (const fn of resources.filter(is("google_cloudfunctions2_function", "google_cloudfunctions_function"))) {
    const topics =
      fn.type === "google_cloudfunctions2_function"
        ? topicOf(fn, "event_trigger", ["event_trigger", "pubsub_topic"])
        : topicOf(fn, "event_trigger", ["event_trigger", "resource"]);
    if (drawn(fn)) flowAll(topics, [fn.key], "async", resourceEvidence(fn, { note: "event trigger" }));
  }
  for (const job of resources.filter(is("google_cloud_scheduler_job"))) {
    const to = [
      ...topicOf(job, "pubsub_target", ["pubsub_target", "topic_name"]),
      ...keys(targets(job, "http_target", REFS_ONLY, DRAWN)),
    ];
    if (drawn(job))
      flowAll([job.key], to.length ? to : outside(first(job, ["http_target", "uri"])), "async", resourceEvidence(job));
  }
  for (const sch of resources.filter(is("aws_scheduler_schedule")))
    if (drawn(sch))
      flowAll(
        [sch.key],
        keys(targets(sch, "target", ["target", "arn"], DRAWN, lambdaArn)),
        "async",
        resourceEvidence(sch),
      );

  // ------------------------------------------------ autoscaling (A3): ECS, Container Apps, App Service, Cloud Run
  // tfScaling.ts reads one policy's blocks; here its resources are joined to the drawn node it scales. A node gets
  // one policy: two policies (or one node standing for several instances) are a conflict, reported, never merged.
  const scaling = new Map<Resource, { provider: string; kind: string; creates: (() => ScalingResult)[] }>();
  const scale = (r: Resource, provider: string, kind: string, create: () => ScalingResult) => {
    if (!drawn(r) || extras.has(r)) return;
    const entry = scaling.get(r) ?? { provider, kind, creates: [] };
    if (entry.creates.length < 2) entry.creates.push(create);
    scaling.set(r, entry);
  };
  /** The one resource an attribute of this instance names: its reference, else its value. */
  const oneTarget = (r: Resource, inst: Instance, attr: string, ok: (t: Resource) => boolean) => {
    const byRef = targets(r, attr, REFS_ONLY, ok);
    if (byRef.length) return byRef.length === 1 ? byRef[0] : undefined;
    const v = strings(inst, [attr])[0];
    const found = v && spend(1) ? byValue(v, ok) : [];
    return found.length === 1 ? found[0] : undefined;
  };
  /** At most one more than a policy may have: the extra one refuses it as out of bounds. */
  const appendCapped = <K, V>(m: Map<K, V[]>, k: K, v: V, max: number) => {
    const list = m.get(k);
    if (!list) m.set(k, [v]);
    else if (list.length <= max) list.push(v);
  };

  // ECS: a scalable target and its policies, on resource id "service/<cluster>/<service>"; step policies' alarms.
  const SERVICES = is("aws_ecs_service");
  const SCALABLE = is("aws_appautoscaling_target");
  const SCALING_POLICIES = is("aws_appautoscaling_policy");
  const lastSegment = (v: string) => v.slice(v.lastIndexOf("/") + 1);
  const clusters = new Map<Resource, string | undefined>();
  const clusterOf = (s: Resource) => {
    if (!clusters.has(s)) {
      const named = first(s, ["cluster"]);
      const byRef = named ? [] : targets(s, "cluster", REFS_ONLY, is("aws_ecs_cluster"));
      clusters.set(s, named ? lastSegment(named) : byRef.length === 1 ? first(byRef[0], ["name"]) : undefined);
    }
    return clusters.get(s);
  };
  const servicesByName = new BoundedIndex<Resource>(50);
  for (const s of resources.filter(SERVICES))
    for (const n of new Set(s.instances.map((i) => strings(i, ["name"])[0])))
      if (n) servicesByName.add(`${s.file}\u0001${n}`, s);
  /** "service/<cluster>/<service>" → its service: by name, and by its cluster's last segment where that's known. */
  const serviceNamed = (file: number, id: string | undefined) => {
    const m = id ? /^service\/([^/]{1,255})\/([^/]{1,255})$/.exec(id) : null;
    if (!m) return undefined;
    const named = servicesByName.get(`${file}\u0001${m[2]}`);
    const found = named.filter((s) => clusterOf(s) === m[1]);
    return found.length === 1
      ? found[0]
      : named.length === 1 && clusterOf(named[0]) === undefined
        ? named[0]
        : undefined;
  };
  const isEcs = (inst: Instance) =>
    strings(inst, ["service_namespace"])[0] === "ecs" &&
    strings(inst, ["scalable_dimension"])[0] === "ecs:service:DesiredCount";
  interface EcsJoin {
    targets: Instance[];
    policies: { res: Resource; inst: Instance }[];
    scheduled: boolean;
  }
  const ecs = new Map<Resource, EcsJoin>();
  const ecsOf = (s: Resource) => {
    let e = ecs.get(s);
    if (!e) ecs.set(s, (e = { targets: [], policies: [], scheduled: false }));
    return e;
  };
  /** A scalable target's service: a reference to it, else the target's resource id. */
  const scalableService = new Map<Resource, Resource | undefined>();
  const targetIds = new BoundedIndex<Resource>(1);
  for (const t of resources.filter(SCALABLE)) {
    const byRef = targets(t, "resource_id", REFS_ONLY, SERVICES);
    const served = new Set<Resource>();
    for (const inst of t.instances) {
      if (!isEcs(inst)) continue;
      const id = strings(inst, ["resource_id"])[0];
      const svc = byRef.length ? (byRef.length === 1 ? byRef[0] : undefined) : serviceNamed(t.file, id);
      if (!svc) continue;
      served.add(svc);
      const e = ecsOf(svc);
      // A second target is a conflict: no need to keep more.
      if (e.targets.length < 2) e.targets.push(inst);
      if (id) targetIds.add(`${t.file}\u0001${id}`, svc);
    }
    scalableService.set(t, served.size === 1 ? [...served][0] : undefined);
  }
  /** A policy's (or scheduled action's) service: through its target, its service, else its resource id. */
  const policyService = (p: Resource, inst: Instance) => {
    const namespace = strings(inst, ["service_namespace"])[0];
    if (namespace !== undefined && namespace !== "ecs") return undefined;
    const viaTarget = new Set(targets(p, "resource_id", REFS_ONLY, SCALABLE).map((t) => scalableService.get(t)));
    if (viaTarget.size) return viaTarget.size === 1 ? [...viaTarget][0] : undefined;
    const direct = targets(p, "resource_id", REFS_ONLY, SERVICES);
    if (direct.length) return direct.length === 1 ? direct[0] : undefined;
    const id = strings(inst, ["resource_id"])[0];
    return id ? (targetIds.get(`${p.file}\u0001${id}`)[0] ?? serviceNamed(p.file, id)) : undefined;
  };
  const policyArns = new Map<string, Instance>();
  for (const p of resources.filter(SCALING_POLICIES))
    for (const inst of p.instances) {
      const svc = policyService(p, inst);
      if (!svc) continue;
      const e = ecsOf(svc);
      if (e.policies.length <= TF_SCALING_LIMITS.maxPolicies * 2) e.policies.push({ res: p, inst });
      const arn = strings(inst, ["arn"])[0];
      if (arn) policyArns.set(`${p.file}\u0001${arn}`, inst);
    }
  for (const a of resources.filter(is("aws_appautoscaling_scheduled_action")))
    for (const inst of a.instances) {
      const svc = policyService(a, inst);
      if (svc) ecsOf(svc).scheduled = true;
    }
  /** The alarms that invoke each policy instance: by reference to the policy, else by its ARN. */
  const alarmsOf = new Map<Instance, { res: Resource; inst: Instance }[]>();
  for (const a of resources.filter(is("aws_cloudwatch_metric_alarm"))) {
    const byRef = targets(a, "alarm_actions", REFS_ONLY, SCALING_POLICIES).filter((p) => p.instances.length === 1);
    for (const inst of a.instances) {
      const invoked = new Set(byRef.map((p) => p.instances[0]));
      if (!byRef.length)
        for (const arn of strings(inst, ["alarm_actions"])) {
          const p = policyArns.get(`${a.file}\u0001${arn}`);
          if (p) invoked.add(p);
        }
      for (const p of invoked) appendCapped(alarmsOf, p, { res: a, inst }, TF_SCALING_LIMITS.maxPolicies);
    }
  }
  /** Load balancers routing requests to a service: a listener's target group that has the service as a target. */
  const routes = new Set<string>();
  for (const [tg, lbs] of tgLbs)
    for (const svc of tgTargets.get(tg) ?? []) for (const lb of lbs) if (spend(1)) routes.add(`${lb}\u0000${svc}`);
  /** The ALB an attribute names (by reference, else by the names in a label or dimension) that routes to `svc`. */
  const albFor =
    (r: Resource, attr: string, svc: Resource): AlbResolver =>
    (names) => {
      const found = new Set<string>(keys(targets(r, attr, REFS_ONLY, LBS)));
      for (const tg of targets(r, attr, REFS_ONLY, TGS)) for (const lb of tgLbs.get(tg) ?? []) found.add(lb);
      if (!found.size && names.loadBalancer)
        for (const lb of keys(byName(r.file, ["aws_lb", "aws_alb"], names.loadBalancer))) found.add(lb);
      if (!found.size && names.targetGroup)
        for (const tg of byName(r.file, ["aws_lb_target_group", "aws_alb_target_group"], names.targetGroup))
          for (const lb of tgLbs.get(tg) ?? []) found.add(lb);
      const routing = [...found].filter((lb) => routes.has(`${lb}\u0000${svc.key}`));
      return found.size === 1 && routing.length === 1 ? routing[0] : undefined;
    };
  for (const [svc, e] of ecs)
    scale(svc, "AWS ECS", "ECS", () => {
      if (e.targets.length > 1) unsupported("Conflicting controllers target this service; choose one policy");
      if (!e.targets.length) unsupported("ECS scaling policy has no scalable target in these files");
      if (e.scheduled) unsupported("Scheduled ECS scaling actions are not simulated");
      const td = targets(svc, "task_definition", ["task_definition"], is("aws_ecs_task_definition"));
      return ecsScaling({
        target: e.targets[0],
        service: svc.instances[0],
        ...(td.length === 1 && td[0].instances.length ? { task: td[0].instances[0] } : {}),
        policies: e.policies.map(({ res, inst }) => ({
          block: inst,
          loadBalancer: albFor(res, "target_tracking_scaling_policy_configuration", svc),
          alarms: (alarmsOf.get(inst) ?? []).map(({ res: alarm, inst: block }) => ({
            block,
            loadBalancer: albFor(alarm, "dimensions", svc),
            service: (dims) =>
              dims.serviceName !== undefined
                ? dims.serviceName === first(svc, ["name"]) &&
                  (dims.clusterName === undefined || dims.clusterName === clusterOf(svc))
                : targets(alarm, "dimensions", REFS_ONLY, SERVICES).includes(svc),
          })),
        })),
      });
    });

  // Container Apps: the template, its Service Bus rules bound to the queue or topic of that name (in the namespace
  // the rule names, where that's known).
  const busEntities = new BoundedIndex<Resource>(50);
  for (const q of resources.filter(SB))
    for (const n of new Set(q.instances.map((i) => strings(i, ["name"])[0])))
      if (n) busEntities.add(`${q.file}\u0001${q.type}\u0001${n}`, q);
  const namespaces = new Map<Resource, string | undefined>();
  const namespaceOf = (q: Resource) => {
    if (!namespaces.has(q)) {
      const id = first(q, ["namespace_id"]) ?? first(q, ["id"]);
      const byRef = id ? [] : targets(q, "namespace_id", REFS_ONLY, is("azurerm_servicebus_namespace"));
      namespaces.set(
        q,
        (id
          ? /\/namespaces\/([^/]+)/i.exec(id)?.[1]
          : byRef.length === 1
            ? first(byRef[0], ["name"])
            : undefined
        )?.toLowerCase(),
      );
    }
    return namespaces.get(q);
  };
  for (const app of resources.filter(is("azurerm_container_app"))) {
    const inst = app.instances[0];
    if (!inst || !acaHasScaling(inst)) continue;
    scale(app, "Azure Container Apps", "Container Apps", () =>
      acaScaling(inst, (names) => {
        const type = names.queue ? "azurerm_servicebus_queue" : "azurerm_servicebus_topic";
        const found = busEntities
          .get(`${app.file}\u0001${type}\u0001${names.queue ?? names.topic}`)
          .filter(
            (q) =>
              drawn(q) && (!names.namespace || [undefined, names.namespace.toLowerCase()].includes(namespaceOf(q))),
          );
        return found.length === 1 ? found[0].key : undefined;
      }),
    );
  }

  // App Service: Monitor autoscale on a plan that hosts exactly one drawn app. A shared plan's capacity has no one
  // owner: each app on it is told so.
  const PLANS = is("azurerm_service_plan", "azurerm_app_service_plan");
  const WEB_APPS = is("azurerm_linux_web_app", "azurerm_windows_web_app", "azurerm_app_service");
  const hosted = new Map<Resource, Resource[]>();
  for (const app of resources.filter(
    (r) => WEB_APPS(r) || is("azurerm_linux_function_app", "azurerm_windows_function_app", "azurerm_function_app")(r),
  )) {
    if (!drawn(app) || extras.has(app)) continue;
    const plans = new Set([
      ...targets(app, "service_plan_id", ["service_plan_id"], PLANS),
      ...targets(app, "app_service_plan_id", ["app_service_plan_id"], PLANS),
    ]);
    for (const plan of plans) append(hosted, plan, app);
  }
  for (const s of resources.filter(is("azurerm_monitor_autoscale_setting")))
    for (const inst of s.instances) {
      const plan = oneTarget(s, inst, "target_resource_id", PLANS);
      const apps = plan ? (hosted.get(plan) ?? []) : [];
      if (!plan || !apps.length) continue;
      if (apps.length > 1) {
        for (const app of apps)
          scale(app, "Azure App Service", "App Service", () =>
            unsupported("Shared App Service plan: capacity ownership is ambiguous; choose one app"),
          );
        continue;
      }
      const ids = new Set(plan.instances.flatMap((i) => strings(i, ["id"])).map(norm));
      /** A rule's metric resource: the plan by id, else (an unknown id in a plan) only references to the plan. */
      const onPlan = (id: string | undefined) => {
        if (id) return ids.has(norm(id));
        const refs = s.refs?.get("profile") ?? [];
        const named = refs.flatMap((ref) => configs[s.file]?.resolve(s.module, ref) ?? []);
        return named.length > 0 && spend(named.length) && named.every((k) => byKey.get(`${s.file}\u0001${k}`) === plan);
      };
      scale(apps[0], "Azure App Service", "App Service", () =>
        WEB_APPS(apps[0])
          ? appServiceScaling(inst, onPlan)
          : unsupported("App Service plan autoscale on a Functions app is not simulated"),
      );
    }

  // Cloud Run: the service's own template (it always scales; a template that says nothing is left as drawn).
  for (const svc of resources.filter(is("google_cloud_run_v2_service", "google_cloud_run_service"))) {
    const v2 = svc.type === "google_cloud_run_v2_service";
    const inst = svc.instances[0];
    if (inst && cloudRunHasScaling(inst, v2))
      scale(svc, "Google Cloud Run", "Cloud Run", () => (v2 ? cloudRunV2Scaling(inst) : cloudRunV1Scaling(inst)));
  }

  for (const [r, { provider, kind, creates }] of scaling) {
    const c = components.byKey.get(r.key)!;
    try {
      if (r.count > 1)
        unsupported("Conflicting controllers: this node stands for several instances; choose one policy");
      if (creates.length > 1) unsupported("Conflicting controllers target this service; choose one policy");
      const out = creates[0]();
      c.props = { ...c.props, ...out.props, resources: out.resources, autoscaling: out.autoscaling };
      note(diagnostic("importDetail.scalingMapped", { kind }));
    } catch (error) {
      if (!(error instanceof ScalingUnsupported)) throw error;
      c.props = { ...c.props, autoscaling: { mode: "unsupported", provider, reason: error.message } };
      note(
        diagnostic("importDetail.scalingUnsupported", {
          reason: diagnostic("importDetail.scalingReason", { reason: scalingReasonCode(error.message) }),
        }),
      );
    }
  }

  // ------------------------------------------------ references → dependencies (plan), and identities (state)
  const spec: Evidence = { source: "spec" };
  /** Supporting types a component's references pass through: its task definition's roles and secrets. */
  const PASS_THROUGH = new Set(["aws_ecs_task_definition", "aws_launch_template", "aws_iam_instance_profile"]);
  // A supporting resource runs as nothing and reads nothing: what it refers to is a plain dependency, never
  // Identity, Secret or Config (which would also count it as a service reading secrets).
  const dependOn = (r: Resource, t: Resource) => {
    if (drawn(t) && t !== r) links.dep(r.key, t.key, extras.has(r) ? "depends" : relationTo(r.key, t.key), spec);
  };
  /**
   * The resources `r` refers to, each reference and each target once however often the plan repeats them, a pass-
   * through's own references followed one step, all of it counted against the import's work budget.
   */
  const referenced = (r: Resource): Set<Resource> => {
    const out = new Set<Resource>();
    const config = configs[r.file]!;
    const seenRefs = new Set<string>();
    const passed = new Set<Resource>();
    const follow = (from: Resource, refs: Iterable<string>, pass: boolean) => {
      for (const ref of refs) {
        if (seenRefs.has(`${from.key}\u0002${ref}`)) continue;
        seenRefs.add(`${from.key}\u0002${ref}`);
        const keys = config.resolve(from.module, ref);
        if (!spend(keys.length + 1)) return false;
        for (const k of keys) {
          const t = byKey.get(`${r.file}\u0001${k}`);
          if (!t || out.has(t) || passed.has(t)) continue;
          if (drawn(t)) out.add(t);
          else if (pass && PASS_THROUGH.has(t.type)) {
            passed.add(t);
            for (const inner of t.refs?.values() ?? []) if (!follow(t, inner, false)) return false;
          }
        }
      }
      return true;
    };
    for (const refs of r.refs?.values() ?? []) if (!follow(r, refs, true)) break;
    return out;
  };
  for (const r of resources) {
    if (!drawn(r) || (!everything && GLUE.has(r.type))) continue;
    if (r.refs) for (const t of referenced(r)) dependOn(r, t);
    else {
      // A state has no configuration: identities from the attributes that name them.
      const ROLES = is("aws_iam_role");
      for (const path of [["role"], ["role_arn"], ["execution_role_arn"], ["task_role_arn"]])
        for (const t of targets(r, path[0], path, ROLES)) dependOn(r, t);
      for (const td of targets(r, "task_definition", ["task_definition"], is("aws_ecs_task_definition")))
        for (const path of [["execution_role_arn"], ["task_role_arn"]])
          for (const t of targets(td, path[0], path, ROLES)) dependOn(r, t);
      for (const t of targets(r, "identity", ["identity", "identity_ids"], is("azurerm_user_assigned_identity")))
        dependOn(r, t);
      const account = first(r, ["storage_account_name"]);
      if (account) for (const t of byName(r.file, ["azurerm_storage_account"], account)) dependOn(r, t);
    }
  }

  // ------------------------------------------------ grants: IAM policies, role assignments, access policies
  /** Who runs as an identity (an IAM role, a user-assigned identity): the components with Identity on it. */
  const runsAs = new Map<string, string[]>();
  for (const d of links.deps.values()) if (d.relation === "identity") append(runsAs, d.to, d.from);
  const STORES = (t: Resource) => {
    if (!drawn(t)) return false;
    const rel = relationTo("", t.key);
    return rel === "secret" || rel === "config";
  };
  /** IAM policy documents name resources by ARN: the secrets and parameters among them. */
  const policyTargets = (p: Resource): Resource[] => {
    const found = targets(p, "policy", REFS_ONLY, STORES);
    if (found.length) return found;
    const out = new Set<Resource>();
    for (const inst of p.instances)
      for (const doc of strings(inst, ["policy"])) {
        let parsed: unknown;
        try {
          parsed = doc.length <= 20_000 ? JSON.parse(doc) : undefined;
        } catch {
          parsed = undefined;
        }
        const statements = own(parsed, "Statement");
        for (const st of (Array.isArray(statements) ? statements : [statements]).slice(0, 100)) {
          const res = own(st, "Resource");
          for (const arn of (Array.isArray(res) ? res : [res]).slice(0, 200))
            if (typeof arn === "string") for (const t of byValue(arn, STORES)) out.add(t);
        }
      }
    return [...out];
  };
  const ROLE = is("aws_iam_role");
  const roleNamed = (r: Resource, attr: string) => {
    const found = targets(r, attr, [attr], ROLE);
    if (found.length) return found;
    return strings(r.instances[0] ?? { values: undefined, sensitive: undefined }, [attr]).flatMap((n) =>
      byName(r.file, ["aws_iam_role"], n),
    );
  };
  // Grants are collected first, one per role and store (the first policy that grants it is its evidence), and only
  // then expanded across the components running as the role: thousands of policies granting one secret through one
  // role cost one expansion, not one each.
  const grants = new Map<string, { role: Resource; store: Resource; via: Resource }>();
  const grant = (roles: Resource[], stores: Resource[], via: Resource, also?: Resource) => {
    for (const role of roles) {
      if (!runsAs.has(role.key)) continue;
      for (const store of stores) {
        const id = `${role.key}\u0001${store.key}`;
        if (!grants.has(id)) grants.set(id, { role, store, via });
        used.add(via);
        if (also) used.add(also);
      }
    }
  };
  const policyCache = new Map<Resource, Resource[]>();
  const storesOf = (p: Resource) => {
    let stores = policyCache.get(p);
    if (!stores) policyCache.set(p, (stores = policyTargets(p)));
    return stores;
  };
  for (const p of resources.filter(is("aws_iam_role_policy"))) grant(roleNamed(p, "role"), storesOf(p), p);
  for (const a of resources.filter(is("aws_iam_role_policy_attachment", "aws_iam_policy_attachment"))) {
    const roles = a.type === "aws_iam_policy_attachment" ? roleNamed(a, "roles") : roleNamed(a, "role");
    for (const p of targets(a, "policy_arn", ["policy_arn"], is("aws_iam_policy"))) grant(roles, storesOf(p), p, a);
  }
  for (const { role, store, via } of grants.values()) {
    const evidence = resourceEvidence(via, { note: `as ${labelFor(role)}` });
    for (const user of runsAs.get(role.key) ?? []) {
      if (!spend(1)) break;
      links.dep(user, store.key, relationTo(user, store.key), evidence);
    }
  }

  /** Components whose own (system-assigned) identity is a principal: they sign in as their managed identity. */
  const ownIdentity = new Set<string>();
  /** Who an Azure principal id is: a component's own identity, or the components running as a user-assigned one. */
  const principalsOf = (r: Resource, attr: string): string[] => {
    let found = targets(r, attr, REFS_ONLY, (t) => drawn(t) || t.type === "azurerm_user_assigned_identity");
    if (!found.length)
      found = strings(r.instances[0] ?? { values: undefined, sensitive: undefined }, [attr]).flatMap((v) => [
        ...principals.get(v.toLowerCase()),
      ]);
    return [
      ...new Set(
        found.flatMap((t) => {
          if (t.type === "azurerm_user_assigned_identity") return runsAs.get(t.key) ?? keys([t]);
          if (!extras.has(t)) ownIdentity.add(t.key);
          return keys([t]);
        }),
      ),
    ];
  };
  /** A store reached by a grant to the component's own identity says so on the connection. */
  const signsIn = (key: string, relation: string) =>
    ownIdentity.has(key) && (relation === "secret" || relation === "config") ? "managed identity" : undefined;
  const MESSAGING = (key: string) =>
    ["topic", "queue", "stream"].includes(getStencil(components.stencilOf(key)).simRole);
  for (const a of resources.filter(is("azurerm_role_assignment"))) {
    // The scope may be a subscription under a topic: its topic is what's drawn.
    let scope = keys(targets(a, "scope", ["scope"], drawn));
    let group: Record<string, unknown> | undefined;
    if (!scope.length) {
      const subs = targets(a, "scope", ["scope"], is("azurerm_servicebus_subscription"));
      for (const s of subs) {
        scope.push(...keys(targets(s, "topic_id", ["topic_id"], is("azurerm_servicebus_topic"))));
        const n = first(s, ["name"]);
        if (n && /^[\w.~-]{1,50}$/.test(n)) group = { group: n };
      }
      scope = [...new Set(scope)];
    }
    const who = principalsOf(a, "principal_id");
    const role = first(a, ["role_definition_name"]) ?? "";
    if (!scope.length || !who.length) continue;
    const evidence = resourceEvidence(a, { note: role.slice(0, 60) || undefined });
    for (const t of scope)
      for (const u of who) {
        if (u === t) continue;
        if (MESSAGING(t) && /receiver|reader|subscriber|listen/i.test(role)) links.flow(t, u, "async", evidence, group);
        else if (MESSAGING(t) && /sender|publisher|writer|send/i.test(role)) links.flow(u, t, "async", evidence);
        else links.dep(u, t, relationTo(u, t), evidence, undefined, signsIn(u, relationTo(u, t)));
      }
    used.add(a);
  }
  for (const p of resources.filter(is("azurerm_key_vault_access_policy"))) {
    const vaults = keys(targets(p, "key_vault_id", ["key_vault_id"], is("azurerm_key_vault")));
    const who = principalsOf(p, "object_id");
    for (const v of vaults)
      for (const u of who) links.dep(u, v, "secret", resourceEvidence(p), undefined, signsIn(u, "secret"));
    if (vaults.length && who.length) used.add(p);
  }

  // ------------------------------------------------ what isn't drawn, and why
  for (const r of resources) {
    if (drawn(r) || used.has(r) || r.mode === "data") continue;
    if (GLUE.has(r.type)) {
      const reason = /^aws_iam_|_role_assignment$|_access_policy$/.test(r.type)
        ? diagnostic("importReason.accessAndPermissions")
        : diagnostic("importReason.connectsNothingInTheseFiles");
      skip(r.type, r.name, reason);
    }
  }
  for (const [key, d] of destroyed)
    if (!byKey.has(key)) skip(d.type, d.name, diagnostic("importDetail.destroyedByThisPlan"));
  const rows = [...skipped.values()].sort((a, b) => b.names.length - a.names.length || a.type.localeCompare(b.type));
  for (const { type, reason, names: n } of rows)
    g.notDrawn.push({
      name: n.length === 1 ? `${type} ${n[0]}` : diagnostic("importReport.namedCount", { name: type, count: n.length }),
      reason,
    });
  if (!g.components.length) throw new ImportError(tr("importDetail.theresNothingToDrawNoneOf"));
  g.links = links.list();

  // ------------------------------------------------ notes: the plan's changes, what's summarised, budgets
  if (kinds.has("plan") && changes.add + changes.change + changes.destroy)
    note(
      diagnostic("importDetail.planValue0ToAddValue1To", {
        value0: changes.add,
        value1: changes.change,
        value2: changes.destroy,
      }),
    );
  const supporting = rows.filter(
    (r) => diagnosticKey(r.reason) !== diagnosticKey(diagnostic("importDetail.destroyedByThisPlan")),
  );
  const count = supporting.reduce((n, r) => n + r.names.length, 0);
  if (count) {
    // Broad kinds, the most common first: "access and permissions, networking and helpers".
    const kinds = new Map<string, { text: ImportText; count: number }>();
    for (const r of supporting) {
      const kind =
        kindsByReason.get(typeof r.reason === "string" ? r.reason : r.reason.code) ?? diagnostic("importKind.parts");
      const key = diagnosticKey(kind);
      kinds.set(key, { text: kind, count: (kinds.get(key)?.count ?? 0) + r.names.length });
    }
    const reasons = [...kinds.values()].sort((a, b) => b.count - a.count).map((kind) => kind.text);
    const listed = reasons.length > 5 ? [...reasons.slice(0, 4), diagnostic("importKind.more")] : reasons;
    const joined = { list: listed };
    note(diagnostic("importDetail.supporting", { count, kinds: joined }));
  }
  if (budget.exhausted) note(diagnostic("importDetail.someReferencesWerentFollowedThePlan"));

  // ------------------------------------------------ boundaries: modules, else Azure resource groups
  const byComponent = new Map<string, Resource>();
  for (const r of resources) if (drawn(r)) byComponent.set(r.key, r);
  const multi = files.length > 1;
  const fileName = (i: number) => files[i]?.name.replace(/^.*[\\/]/, "") ?? "";
  const modular = g.components.some((c) => byComponent.get(c.key)?.module);
  /**
   * An Azure resource's group: its own `resource_group_name`, the group in its id, or its parent's (a queue's
   * namespace, a database's server).
   */
  const resourceGroup = (r: Resource, depth: number): string | undefined => {
    const rg =
      targets(r, "resource_group_name", REFS_ONLY, is("azurerm_resource_group")).map(labelFor)[0] ??
      first(r, ["resource_group_name"]) ??
      /\/resourceGroups\/([^/]+)/i.exec(first(r, ["id"]) ?? "")?.[1];
    if (rg) return /^[\w.()-]{1,90}$/.test(rg) ? rg : undefined;
    if (depth >= 2 || !r.type.startsWith("azurerm_")) return undefined;
    for (const attr of ["namespace_id", "server_id", "key_vault_id", "storage_account_id", "eventhub_namespace_id"])
      for (const parent of targets(r, attr, [attr], (t) => t.type.startsWith("azurerm_"))) {
        const found = resourceGroup(parent, depth + 1);
        if (found) return found;
      }
    return undefined;
  };
  const tones = new Map<string, Map<string, number>>();
  const place = (c: ImportComponent, groupKey: string, groupLabel: string, type: string) => {
    c.group = groupKey;
    c.context = groupLabel;
    const t = tones.get(groupKey) ?? new Map<string, number>();
    const tone = toneOf(type) ?? "neutral";
    t.set(tone, (t.get(tone) ?? 0) + 1);
    tones.set(groupKey, t);
    if (!g.groups.some((x) => x.key === groupKey)) g.groups.push({ key: groupKey, label: label(groupLabel) });
  };
  for (const c of g.components) {
    const r = byComponent.get(c.key);
    if (!r) continue;
    if (modular) {
      if (r.module)
        place(c, `${r.file}\u0001${r.module}`, multi ? `${r.module} (${fileName(r.file)})` : r.module, r.type);
      continue;
    }
    const rg = resourceGroup(r, 0);
    if (rg) place(c, `${r.file}\u0001rg\u0001${rg.toLowerCase()}`, multi ? `${rg} (${fileName(r.file)})` : rg, r.type);
  }
  for (const gr of g.groups) {
    const t = [...(tones.get(gr.key) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (t) gr.tone = t as ImportGraph["groups"][number]["tone"];
  }

  const base = files[0]?.name.replace(/^.*[\\/]/, "").replace(/\.json$/i, "") ?? "";
  g.title =
    files.length > 1 || !base || /^(plan|tfplan|state|tfstate|terraform|show|output|out)$/i.test(base)
      ? g.format
      : label(base);
  if (everything) g.title = label(`${g.title} (everything)`);
  return g;
}
