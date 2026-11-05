import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { EditorApi } from "../editor/types";
import { nodeCachePolicy } from "../editor/cachePolicy";
import type { DiagramFile } from "../model/types";
import { checkCache, type CachePolicy, type CacheRule, type CacheTable, type Popularity } from "../model/caching";
import { newCacheRule } from "../model/cacheEdits";
import { oneFetchPerItem } from "../sim/cachePresets";
import { revisionAtLeast } from "../model/revisions";
import { matchText } from "../model/routingAppearance";
import { MatchEditor } from "./RoutingFields";
import { ReadoutDisclosure } from "../live/ReadoutDisclosure";
import { configuredPlanning } from "./cache";
import { planningHost } from "./host";
import { popularityTable } from "../sim/cache/popularity";
import { t, useLocale } from "../i18n";
import { formatNumber, formatPercent } from "../i18n/format";
import { cacheDuration, cacheRate, policyWords, popularityLabel } from "./cacheWords";
import { isolate } from "../live/bidi";
import { notify } from "../interop/ui/toast";
import "../styles/cache.css";

const noSubscribe = () => () => {};
const noState = () => null;
const presets = [10_000, 60_000, 300_000, 3_600_000];
let cacheEdit = 0;

function StaleWindow({
  id,
  policy,
  set,
}: {
  id: string;
  policy: CachePolicy;
  set(p: CachePolicy, field?: string): void;
}) {
  const [custom, setCustom] = useState(false);
  const value = policy.staleWhileRevalidateMs ?? 0;
  const isCustom = custom || ![0, 10_000, 60_000, 300_000].includes(value);
  return (
    <>
      <label className="insp-field">
        <span className="insp-label">{t("cache.staleWindow")}</span>
        <select
          className="insp-input"
          data-testid={`${id}-stale-window`}
          value={isCustom ? "custom" : value}
          aria-describedby={`${id}-stale-hint`}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setCustom(next === "custom");
            if (next !== "custom") {
              const { staleWhileRevalidateMs: _old, ...rest } = policy;
              set(Number(next) ? { ...policy, staleWhileRevalidateMs: Number(next) } : rest);
            }
          }}
        >
          <option value={0}>{t("cache.off")}</option>
          {[10_000, 60_000, 300_000].map((ms) => (
            <option key={ms} value={ms}>
              {cacheDuration(ms)}
            </option>
          ))}
          <option value="custom">{t("cache.custom")}</option>
        </select>
      </label>
      {isCustom && (
        <label className="insp-field">
          <span className="insp-label">{t("cache.staleMs")}</span>
          <input
            type="number"
            className="insp-input"
            data-testid={`${id}-stale-ms`}
            min={0}
            max={86_400_000}
            value={value}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              if (Number.isFinite(next) && next >= 0 && next <= 86_400_000)
                set({ ...policy, staleWhileRevalidateMs: next }, "stale");
            }}
          />
        </label>
      )}
      <p className="insp-note" id={`${id}-stale-hint`}>
        {t("cache.staleHint")}
      </p>
    </>
  );
}

function MessagePatterns({ types, id, set }: { types?: string[]; id: string; set: (types?: string[]) => void }) {
  const external = types?.join(", ") ?? "";
  const [draft, setDraft] = useState({ text: external, external });
  if (draft.external !== external) setDraft({ text: external, external });
  return (
    <input
      className="insp-input"
      data-testid={`${id}-types-input`}
      value={draft.external === external ? draft.text : external}
      onChange={(e) => {
        const text = e.currentTarget.value;
        const next = text
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        setDraft({ text, external: next.join(", ") });
        set(next.length ? next : undefined);
      }}
    />
  );
}

function CachePolicyFields({
  id,
  policy: p,
  set,
}: {
  id: string;
  policy: CachePolicy;
  set(p: CachePolicy, field?: string): void;
}) {
  const [customChoice, setCustom] = useState(false);
  const storedPolicy = useRef<CachePolicy>(p.noStore ? { ttlMs: 300_000, keys: 50_000, popularity: "typical" } : p);
  const custom = customChoice || !presets.includes(p.ttlMs ?? 300_000);
  const [draft, setDraft] = useState<string>();
  const [seen, setSeen] = useState(p.ttlMs);
  if (seen !== p.ttlMs) {
    setSeen(p.ttlMs);
    setDraft(undefined);
  }
  const keys = p.keys ?? 1000;
  const popularity = p.popularity ?? "typical";
  return (
    <>
      <label className="insp-check">
        <input
          type="checkbox"
          data-testid={`${id}-no-store`}
          checked={!!p.noStore}
          onChange={(e) => {
            if (e.currentTarget.checked) {
              storedPolicy.current = p;
              set({ noStore: true });
            } else set(storedPolicy.current);
          }}
        />
        {t("cache.noStore")}
      </label>
      {!p.noStore && (
        <>
          <fieldset className="cache-presets" aria-describedby={`${id}-ttl-hint`}>
            <legend className="insp-label">{t("cache.keepFor")}</legend>
            {presets.map((ttl) => (
              <label className="route-chip" key={ttl}>
                <input
                  type="radio"
                  name={`${id}-ttl`}
                  data-testid={`${id}-ttl-${ttl}`}
                  checked={!custom && p.ttlMs === ttl}
                  onChange={() => {
                    setCustom(false);
                    setDraft(undefined);
                    set({ ...p, ttlMs: ttl });
                  }}
                />
                {cacheDuration(ttl)}
              </label>
            ))}
            <label className="route-chip">
              <input
                type="radio"
                name={`${id}-ttl`}
                data-testid={`${id}-ttl-custom`}
                checked={custom}
                onChange={() => {
                  setCustom(true);
                  setDraft(undefined);
                }}
              />
              {t("cache.custom")}
            </label>
          </fieldset>
          {custom && (
            <label className="insp-field">
              <span className="insp-label">{t("cache.ttlMs")}</span>
              <input
                type="number"
                className="insp-input"
                min={100}
                max={86_400_000}
                data-testid={`${id}-ttl`}
                value={draft ?? p.ttlMs}
                aria-invalid={draft !== undefined && !(Number(draft) >= 100 && Number(draft) <= 86_400_000)}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setDraft(value);
                  if (Number(value) >= 100 && Number(value) <= 86_400_000) set({ ...p, ttlMs: Number(value) }, "ttl");
                }}
              />
            </label>
          )}
          <p className="insp-note" id={`${id}-ttl-hint`}>
            {t("cache.ttlHint")}
          </p>
          <label className="insp-field">
            <span className="insp-label">{t("cache.items")}</span>
            <input
              type="number"
              className="insp-input"
              data-testid={`${id}-keys`}
              min={1}
              max={1_000_000}
              value={keys}
              onChange={(e) => {
                const value = Number(e.currentTarget.value);
                if (Number.isInteger(value) && value >= 1 && value <= 1_000_000) set({ ...p, keys: value }, "keys");
              }}
            />
          </label>
          {keys > 1 && (
            <>
              <label className="insp-field">
                <span className="insp-label">{t("cache.popularity")}</span>
                <select
                  className="insp-input"
                  data-testid={`${id}-popularity`}
                  aria-describedby={`${id}-popularity-sentence`}
                  value={popularity}
                  onChange={(e) => set({ ...p, popularity: e.currentTarget.value as Popularity })}
                >
                  {(["even", "gentle", "typical", "steep"] as const).map((v) => (
                    <option key={v} value={v}>
                      {popularityLabel(v)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="insp-note" id={`${id}-popularity-sentence`} data-testid={`${id}-popularity-sentence`}>
                {t("cache.popularityTop", { percent: Math.round(100 * popularityTable(keys, popularity).topPercent) })}
              </p>
            </>
          )}
          <ReadoutDisclosure title={t("cache.expires")} testId={`${id}-expires`}>
            <label className="insp-check">
              <input
                type="checkbox"
                data-testid={`${id}-coalesce`}
                checked={!!p.coalesce}
                onChange={(e) => set(e.currentTarget.checked ? oneFetchPerItem(p) : { ...p, coalesce: false })}
              />
              {t("cache.coalescingAction", { mode: "coalesce" })}
            </label>
            <p className="insp-note">{t("cache.coalesceHint")}</p>
            <StaleWindow id={id} policy={p} set={set} />
          </ReadoutDisclosure>
        </>
      )}
    </>
  );
}

export function CacheFields({
  editor,
  nodeId,
  props,
  counts,
  readDiagram,
  planning,
  simulations,
  initiallyOpen = true,
}: {
  editor: EditorApi;
  nodeId: string;
  props: Record<string, unknown>;
  counts: { nodes: number; edges: number };
  readDiagram?: () => DiagramFile;
  planning?: DiagramFile["planning"];
  simulations?: DiagramFile["simulations"];
  initiallyOpen?: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState<string | null>(
    initiallyOpen ? ((props.cache as CacheTable).rules[0]?.id ?? null) : null,
  );
  const [announce, setAnnounce] = useState("");
  const [problem, setProblem] = useState("");
  const focus = useRef<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const add = useRef<HTMLButtonElement>(null);
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  const state = useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const version = editor.getDocumentVersion();
  const limited = counts.nodes > 256 || counts.edges > 512;
  const read = () => ({
    ...version,
    limited,
    reader: readDiagram,
    document: limited ? undefined : (readDiagram?.() ?? editor.getDiagram()),
  });
  const [snapshot, setSnapshot] = useState(read);
  let current = snapshot;
  if (
    snapshot.identity !== version.identity ||
    snapshot.revision !== version.revision ||
    snapshot.limited !== limited ||
    snapshot.reader !== readDiagram
  ) {
    current = read();
    setSnapshot(current);
  }
  const doc = limited ? undefined : current.document;
  const policy = nodeCachePolicy(
    editor,
    nodeId,
    live,
    current.document ?? { nodes: [{ id: nodeId, props }], simulations },
  );
  const table = policy?.table ?? (props.cache as CacheTable);
  const configured = doc && configuredPlanning(doc, state);
  const demand = configured?.analysis.cacheDemand?.[nodeId];
  const origin = doc?.edges
    .filter((e) => e.from === nodeId && e.kind === "sync")
    .map((e) => doc.nodes.find((n) => n.id === e.to)?.label ?? e.to)
    .join(", ");
  useLayoutEffect(() => {
    if (focus.current) {
      (rows.current.get(focus.current) ?? add.current)?.focus();
      focus.current = null;
    }
  });
  const save = (next: CacheTable, field?: string) => {
    try {
      checkCache(next);
      policy?.set(next, { merge: field ? `cache:${nodeId}:${field}` : `cache:${nodeId}:edit:${++cacheEdit}` });
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const update = (rule: CacheRule, patch: Partial<CacheRule>, field?: string) =>
    save(
      { ...table, rules: table.rules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)) },
      field ? `${rule.id}:${field}` : undefined,
    );
  const move = (id: string, delta: number) => {
    const at = table.rules.findIndex((r) => r.id === id),
      next = at + delta;
    if (next < 0 || next >= table.rules.length) return;
    const rules = [...table.rules];
    [rules[at], rules[next]] = [rules[next], rules[at]];
    save({ ...table, rules });
    focus.current = id;
    setAnnounce(t("routing.movedTo", { position: next + 1, count: rules.length }));
  };
  const remove = (id: string) => {
    const at = table.rules.findIndex((r) => r.id === id);
    const rules = table.rules.filter((r) => r.id !== id);
    save({ ...table, rules });
    focus.current = rules[Math.min(at, rules.length - 1)]?.id ?? "add";
    setOpen(null);
    const message = t("routing.ruleRemoved", { rule: at + 1 });
    setAnnounce(message);
    notify(message, { action: { label: t("routing.undo"), run: () => editor.undo() } });
  };
  const keys = (id: string) => (e: KeyboardEvent) => {
    if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      move(id, e.key === "ArrowUp" ? -1 : 1);
    }
    if (e.key === "Delete") {
      e.preventDefault();
      remove(id);
    }
  };
  return (
    <fieldset
      data-testid="inspector-cache"
      className="cache-fields cache-edit-fields"
      disabled={policy?.editable === false}
      aria-label={t("cache.rules")}
    >
      <p className="insp-note">{t("cache.rulesHint")}</p>
      {!revisionAtLeast((doc?.planning ?? planning)?.revision, "p3-w3") && (
        <p className="insp-note">{t("cache.dormant")}</p>
      )}
      {doc && !origin && <p className="insp-note">{t("cache.noOrigin")}</p>}
      <div role="group" aria-label={t("cache.rules")}>
        <div className="cache-row cache-head" aria-hidden="true">
          <span data-testid="cache-order-heading">{t("routing.order")}</span>
          <span data-testid="cache-match-heading">{t("routing.match")}</span>
          <span>{t("cache.keepFor")}</span>
          <span>{t("cache.items")}</span>
        </div>
        {table.rules.map((rule, i) => (
          <div key={rule.id}>
            <button
              type="button"
              className="cache-row"
              data-testid={`cache-rule-${rule.id}`}
              aria-expanded={open === rule.id}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
              ref={(el) => {
                if (el) rows.current.set(rule.id, el);
                else rows.current.delete(rule.id);
              }}
              onClick={() => setOpen(open === rule.id ? null : rule.id)}
              onKeyDown={keys(rule.id)}
            >
              <span>{i + 1}</span>
              <span className="route-cut" title={matchText(rule.match)}>
                {rule.label && (
                  <small>
                    <bdi>{rule.label}</bdi>
                    <br />
                  </small>
                )}
                <bdi dir="ltr">{matchText(rule.match)}</bdi>
              </span>
              <span>
                <bdi>{rule.policy.noStore ? t("cache.noStore") : cacheDuration(rule.policy.ttlMs!)}</bdi>
              </span>
              <span>{rule.policy.noStore ? "—" : formatNumber(rule.policy.keys ?? 1000)}</span>
            </button>
            {open === rule.id && (
              <div className="route-details" data-testid={`cache-rule-${rule.id}-details`}>
                <label className="insp-field">
                  <span className="insp-label">{t("routing.ruleName")}</span>
                  <input
                    className="insp-input"
                    data-testid={`cache-rule-${rule.id}-label`}
                    value={rule.label ?? ""}
                    onChange={(e) => update(rule, { label: e.currentTarget.value }, "label")}
                  />
                </label>
                <p
                  className="insp-note route-cut"
                  title={matchText(rule.match)}
                  data-testid={`cache-rule-${rule.id}-match-summary`}
                >
                  {t("cache.matchSummary", { match: isolate(matchText(rule.match)) })}
                </p>
                <ReadoutDisclosure title={t("cache.editMatch")} testId={`cache-rule-${rule.id}-edit-match`}>
                  <MatchEditor
                    match={rule.match}
                    testId={`cache-rule-${rule.id}-match`}
                    onChange={(match) =>
                      update(
                        rule,
                        { match: { ...match, ...(rule.match.types ? { types: rule.match.types } : {}) } },
                        "match",
                      )
                    }
                  />
                  <ReadoutDisclosure title={t("messageTypes.messages")} testId={`cache-rule-${rule.id}-types`}>
                    <label className="insp-field">
                      <span className="insp-label">{t("messageTypes.messages")}</span>
                      <MessagePatterns
                        id={`cache-rule-${rule.id}`}
                        types={rule.match.types}
                        set={(types) => update(rule, { match: { ...rule.match, types } }, "types")}
                      />
                    </label>
                  </ReadoutDisclosure>
                </ReadoutDisclosure>
                <CachePolicyFields
                  id={`cache-rule-${rule.id}`}
                  policy={rule.policy}
                  set={(policy, field) => update(rule, { policy }, field)}
                />
                <p data-testid={`cache-rule-${rule.id}-expected`} className="insp-note" dir="auto">
                  {!configured
                    ? t("cache.analysisLimit")
                    : demand?.[rule.id]?.rate
                      ? rule.policy.noStore
                        ? t("cache.expectedNotCached", {
                            rate: cacheRate(demand[rule.id].rate),
                            origin: isolate(origin || t("cache.origin")),
                          })
                        : t("cache.expected", {
                            hit: isolate(formatPercent(demand[rule.id].hitRatio)),
                            rate: cacheRate(demand[rule.id].rate, true),
                            fetch: cacheRate(
                              demand[rule.id].rate * (demand[rule.id].fetchShare ?? 1 - demand[rule.id].hitRatio),
                              false,
                              demand[rule.id].fetchShare === undefined
                                ? { maximumFractionDigits: 0 }
                                : { maximumSignificantDigits: 2 },
                            ),
                            origin: isolate(origin || t("cache.origin")),
                          })
                      : t("cache.noTraffic")}
                </p>
                <ReadoutDisclosure title={t("cache.ruleActions")} testId={`cache-rule-${rule.id}-actions`}>
                  <div className="cache-rule-actions">
                    <button
                      type="button"
                      className="btn"
                      data-testid={`cache-rule-${rule.id}-up`}
                      disabled={i === 0}
                      onClick={() => move(rule.id, -1)}
                    >
                      {t("routing.moveUp")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`cache-rule-${rule.id}-down`}
                      disabled={i === table.rules.length - 1}
                      onClick={() => move(rule.id, 1)}
                    >
                      {t("routing.moveDown")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`cache-rule-${rule.id}-delete`}
                      onClick={() => remove(rule.id)}
                    >
                      {t("inspector.delete")}
                    </button>
                  </div>
                </ReadoutDisclosure>
              </div>
            )}
          </div>
        ))}
      </div>
      <ReadoutDisclosure
        title={t("cache.everythingElse")}
        testId="cache-default"
        summary={table.default ? policyWords(table.default) : t("cache.notCached")}
      >
        <label className="insp-check">
          <input
            type="checkbox"
            data-testid="cache-default-enabled"
            checked={!!table.default}
            onChange={(e) =>
              save({
                ...table,
                default: e.currentTarget.checked ? { ttlMs: 300_000, keys: 50_000, popularity: "typical" } : undefined,
              })
            }
          />
          {t("cache.storeDefault")}
        </label>
        {table.default && (
          <CachePolicyFields
            id="cache-default"
            policy={table.default}
            set={(policy, field) => save({ ...table, default: policy }, field ? `default:${field}` : undefined)}
          />
        )}
      </ReadoutDisclosure>
      <button
        type="button"
        className="btn"
        ref={add}
        data-testid="cache-add-rule"
        disabled={table.rules.length >= 32}
        onClick={() => {
          const rule = newCacheRule(table);
          save({ ...table, rules: [...table.rules, rule] });
          setOpen(rule.id);
          focus.current = rule.id;
        }}
      >
        {t("routing.addRule")}
      </button>
      {problem && (
        <p role="alert" data-testid="cache-problem">
          {problem}
        </p>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="cache-announce">
        {announce}
      </div>
    </fieldset>
  );
}
