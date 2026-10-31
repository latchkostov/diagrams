import { ReadoutDisclosure } from "../live/ReadoutDisclosure";
import { revisionAtLeast } from "../model/revisions";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { EditorApi } from "../editor/types";
import { createTargetSummaries } from "./targetSummaries";
import type { DiagramFile, PlanningModel } from "../model/types";
import {
  checkAddress,
  checkRouteMatch,
  routingEnabled,
  type HttpMethod,
  type PathMatchKind,
  type RequestAddress,
  type RequestRoute,
  type RouteAction,
  type RouteMarker,
  type RouteMatch,
  type RouteRule,
  type RouteTable,
  type TrafficMix,
} from "../model/requestRouting";
import { matchText, routeLook, routeName, addressText, ROUTE_PALETTE } from "../model/routingAppearance";
import {
  addMixRow,
  addRoute,
  addRule,
  firstTable,
  METHODS,
  moveRule,
  normalizeShares,
  outgoingFlows,
  removeMixRow,
  removeRule,
  routeUsage,
  setTarget,
  shadowedRules,
  splitText,
  switchMixMode,
  updateRule,
  withRouting,
} from "../model/routingEdits";
import { t, useLocale } from "../i18n";
import { formatNumber } from "../i18n/format";
import { explanationRate } from "./format";
import { notify } from "../interop/ui/toast";
import { planningHost } from "./host";
import { RouteSwatch } from "../components/RouteSwatch";
import { routingIntent } from "../editor/routingIntent";
import type { RouteCounts } from "../sim/types";

/**
 * Request routing in the inspector (docs/research/routing.md §4): nothing until someone adds it, then a router's
 * route table (at most four columns), a source's traffic mix (three columns) and the shared route definitions.
 * Every edit is one undo step; edits that need a route and a table or mix together go through applyDiagram.
 */

type Doc = Pick<DiagramFile, "planning" | "nodes" | "edges" | "simulations">;

const markerName = (marker: RouteMarker) =>
  ({
    circle: t("routing.markerCircle"),
    square: t("routing.markerSquare"),
    diamond: t("routing.markerDiamond"),
    triangle: t("routing.markerTriangle"),
  })[marker];
/** The colour's name for screen readers: the palette slot's plain word. */
const colourName = (color: string) =>
  [
    t("routing.colourOrange"),
    t("routing.colourSkyBlue"),
    t("routing.colourGreen"),
    t("routing.colourYellow"),
    t("routing.colourBlue"),
    t("routing.colourVermilion"),
    t("routing.colourPurple"),
  ][ROUTE_PALETTE.indexOf(color as (typeof ROUTE_PALETTE)[number])] ?? color;
/** "orange circle": how a route looks, in words. */
export const lookText = (route: RequestRoute) => {
  const look = routeLook(route);
  return t("routing.look", { colour: colourName(look.color), marker: markerName(look.marker) });
};

/** Turns routing on for the document if needed, in the same change as `edit`. */
function applyRouted(editor: EditorApi, edit: (d: DiagramFile) => void, merge?: string): boolean {
  const next = structuredClone(editor.getDiagram());
  next.planning = withRouting(next.planning);
  edit(next);
  // Replacing the document clears the canvas selection: keep what the inspector is showing.
  const selection = editor.getSelection();
  try {
    editor.applyDiagram(next, merge ? { merge } : undefined);
    editor.select(selection);
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), { kind: "error" });
    return false;
  }
}

/**
 * Calls `reset` when `value` changes to something this editor didn't send itself (Undo, Redo, another editor):
 * local drafts never outlive the saved value they were typed over. Returns how the editor records what it sends.
 */
function useExternal<T>(value: T, reset: () => void) {
  const sent = useRef<unknown>(value);
  const seen = useRef<T>(value);
  useEffect(() => {
    if (Object.is(seen.current, value)) return;
    seen.current = value;
    if (JSON.stringify(sent.current) !== JSON.stringify(value)) reset();
    sent.current = value;
  });
  return (value: unknown) => {
    sent.current = value;
  };
}

// ---------------------------------------------------------------- route definitions

const parseEntries = (text: string, separator: ":" | "="): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(separator);
    if (!line.trim()) continue;
    if (at < 1) throw new Error(t("routing.entryFormat", { separator }));
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
};
const entriesText = (value: Record<string, string> | undefined, separator: ":" | "=") =>
  Object.entries(value ?? {})
    .map(([k, v]) => `${k}${separator === ":" ? ": " : "="}${v}`)
    .join("\n");

/**
 * A route's address: method and path, with host, headers and query folded under Advanced. Drafts stay local until
 * they're a valid address, then save at once (one undo step per field); the problem is said under the field.
 */
function AddressEditor({
  address,
  onChange,
  testId,
}: {
  address: RequestAddress;
  onChange: (address: RequestAddress) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState<{ path?: string; host?: string; headers?: string; query?: string }>({});
  const [problem, setProblem] = useState<string | undefined>();
  const problemId = useId();
  const rememberAddress = useExternal(address, () => {
    setDraft({});
    setProblem(undefined);
  });
  const commit = (next: Partial<typeof draft>) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    try {
      const candidate: RequestAddress = {
        method: address.method,
        path: merged.path ?? address.path,
        ...((merged.host ?? address.host ?? "").trim() ? { host: (merged.host ?? address.host)!.trim() } : {}),
        ...(merged.headers !== undefined
          ? parseEntries(merged.headers, ":")
            ? { headers: parseEntries(merged.headers, ":") }
            : {}
          : address.headers
            ? { headers: address.headers }
            : {}),
        ...(merged.query !== undefined
          ? parseEntries(merged.query, "=")
            ? { query: parseEntries(merged.query, "=") }
            : {}
          : address.query
            ? { query: address.query }
            : {}),
      };
      checkAddress(candidate, "address");
      setProblem(undefined);
      rememberAddress(candidate);
      onChange(candidate);
    } catch (error) {
      setProblem(error instanceof Error ? error.message.replace(/^address\.?\w*:\s*/, "") : String(error));
    }
  };
  return (
    <div className="route-address" data-testid={testId}>
      <div className="insp-row2">
        <label className="insp-field">
          <span className="insp-label">{t("routing.method")}</span>
          <select
            className="insp-input"
            value={address.method}
            data-testid={`${testId}-method`}
            onChange={(e) => onChange({ ...address, method: e.currentTarget.value as HttpMethod })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="insp-field">
          <span className="insp-label">{t("routing.path")}</span>
          <input
            className="insp-input mono"
            value={draft.path ?? address.path}
            // eslint-disable-next-line local/no-literal-ui-text -- an example value in the HTTP grammar, never translated
            placeholder="/orders"
            spellCheck={false}
            aria-invalid={!!problem}
            aria-describedby={problem ? problemId : undefined}
            data-testid={`${testId}-path`}
            onChange={(e) => commit({ path: e.currentTarget.value })}
            onBlur={() => !problem && setDraft({})}
          />
        </label>
      </div>
      {problem && (
        <small id={problemId} className="insp-note" role="status" data-testid={`${testId}-problem`}>
          {problem}
        </small>
      )}
      <ReadoutDisclosure testId={`${testId}-advanced`} title={t("ai.advanced")}>
        <label className="insp-field">
          <span className="insp-label">{t("routing.host")}</span>
          <input
            className="insp-input mono"
            value={draft.host ?? address.host ?? ""}
            // eslint-disable-next-line local/no-literal-ui-text -- an example value in the HTTP grammar, never translated
            placeholder="api.example.com"
            spellCheck={false}
            data-testid={`${testId}-host`}
            onChange={(e) => commit({ host: e.currentTarget.value })}
          />
        </label>
        <label className="insp-field">
          <span className="insp-label">{t("routing.headers")}</span>
          <textarea
            className="insp-input mono"
            rows={2}
            dir="ltr"
            value={draft.headers ?? entriesText(address.headers, ":")}
            // eslint-disable-next-line local/no-literal-ui-text -- an example value in the HTTP grammar, never translated
            placeholder="X-Tenant: blue"
            spellCheck={false}
            data-testid={`${testId}-headers`}
            onChange={(e) => commit({ headers: e.currentTarget.value })}
          />
        </label>
        <label className="insp-field">
          <span className="insp-label">{t("routing.query")}</span>
          <textarea
            className="insp-input mono"
            rows={2}
            dir="ltr"
            value={draft.query ?? entriesText(address.query, "=")}

            placeholder="v=2"
            spellCheck={false}
            data-testid={`${testId}-query`}
            onChange={(e) => commit({ query: e.currentTarget.value })}
          />
        </label>
      </ReadoutDisclosure>
    </div>
  );
}

/** One shared route definition: its name, address and where it's used (edits change every place that uses it). */
function RouteDefinition({
  editor,
  route,
  deletable = false,
}: {
  editor: EditorApi;
  route: RequestRoute;
  deletable?: boolean;
}) {
  const doc: Doc = editor.getDiagram();
  const routes = doc.planning?.requestRoutes ?? [];
  const used = routeUsage(doc, route.id);
  const save = (patch: Partial<RequestRoute>, field: string) =>
    editor.updateMeta(
      {
        planning: { ...doc.planning!, requestRoutes: routes.map((r) => (r.id === route.id ? { ...r, ...patch } : r)) },
      },
      { merge: `routing:route:${route.id}:${field}` },
    );
  return (
    <div className="route-definition" data-testid={`route-def-${route.id}`}>
      <label className="insp-field">
        <span className="insp-label">{t("routing.routeName")}</span>
        <input
          className="insp-input"
          value={route.label ?? ""}
          placeholder={addressText(route.address)}
          data-testid={`route-def-${route.id}-label`}
          onChange={(e) => save({ label: e.currentTarget.value || undefined }, "label")}
        />
      </label>
      <AddressEditor
        address={route.address}
        testId={`route-def-${route.id}-address`}
        onChange={(address) => save({ address }, "address")}
      />
      <p className="insp-note" data-testid={`route-def-${route.id}-used`}>
        {used.length ? t("routing.usedBy", { places: used.join(", ") }) : t("routing.unused")}
      </p>
      {deletable && (
        <button
          type="button"
          className="link-btn"
          disabled={used.length > 0}
          title={used.length ? t("routing.deleteUsed") : undefined}
          data-testid={`request-route-${route.id}-delete`}
          onClick={() =>
            editor.updateMeta({
              planning: { ...doc.planning!, requestRoutes: routes.filter((r) => r.id !== route.id) },
            })
          }
        >
          {t("routing.deleteRoute")}
        </button>
      )}
    </div>
  );
}

/** A form for a new route (method and path); Add creates it with the next free colour and marker. */
function NewRoute({
  onAdd,
  onCancel,
  testId,
  focus = false,
}: {
  onAdd: (a: RequestAddress, label?: string) => void;
  onCancel: () => void;
  testId: string;
  /** Opened from the right-click: the Path field takes focus. */
  focus?: boolean;
}) {
  const path0 = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) path0.current?.focus();
  }, [focus]);
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [path, setPath] = useState("/");
  const [label, setLabel] = useState("");
  let problem: string | undefined;
  try {
    checkAddress({ method, path }, "address");
  } catch (error) {
    problem = error instanceof Error ? error.message.replace(/^address\.?\w*:\s*/, "") : String(error);
  }
  return (
    <div className="route-new" data-testid={testId}>
      <div className="insp-row2">
        <label className="insp-field">
          <span className="insp-label">{t("routing.method")}</span>
          <select
            className="insp-input"
            value={method}
            data-testid={`${testId}-method`}
            onChange={(e) => setMethod(e.currentTarget.value as HttpMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="insp-field">
          <span className="insp-label">{t("routing.path")}</span>
          <input
            className="insp-input mono"
            ref={path0}
            value={path}
            spellCheck={false}
            data-testid={`${testId}-path`}
            aria-invalid={!!problem}
            onChange={(e) => setPath(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !problem) onAdd({ method, path }, label);
            }}
          />
        </label>
      </div>
      <label className="insp-field">
        <span className="insp-label">{t("routing.routeName")}</span>
        <input
          className="insp-input"
          value={label}
          placeholder={t("routing.optional")}
          data-testid={`${testId}-label`}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
      </label>
      {problem && (
        <small className="insp-note" role="status" data-testid={`${testId}-problem`}>
          {problem}
        </small>
      )}
      <div className="route-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!problem}
          data-testid={`${testId}-add`}
          onClick={() => onAdd({ method, path }, label)}
        >
          {t("routing.addRoute")}
        </button>
        <button type="button" className="btn" data-testid={`${testId}-cancel`} onClick={onCancel}>
          {t("routing.cancel")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- route table

/** The editor for one rule's match: methods, path, and Advanced host, header and query conditions. */
function MatchEditor({
  match,
  onChange,
  testId,
}: {
  match: RouteMatch;
  onChange: (m: RouteMatch) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState<{ value?: string; hosts?: string; headers?: string; query?: string }>({});
  const [problem, setProblem] = useState<string | undefined>();
  const rememberMatch = useExternal(match, () => {
    setDraft({});
    setProblem(undefined);
  });
  const kind: PathMatchKind | "any" = match.path?.kind ?? "any";
  const commit = (next: RouteMatch, d: typeof draft = {}) => {
    setDraft(d);
    try {
      checkRouteMatch(next, "match");
      setProblem(undefined);
      rememberMatch(next);
      onChange(next);
    } catch (error) {
      setProblem(error instanceof Error ? error.message.replace(/^match\.?\w*:\s*/, "") : String(error));
    }
  };
  const toggleMethod = (m: HttpMethod) => {
    const set = new Set(match.methods ?? []);
    if (set.has(m)) set.delete(m);
    else set.add(m);
    const methods = METHODS.filter((x) => set.has(x));
    const next = { ...match };
    if (methods.length) next.methods = methods;
    else delete next.methods;
    commit(next);
  };
  return (
    <div className="route-match" data-testid={testId}>
      <fieldset className="route-methods">
        <legend className="insp-label">{t("routing.methods")}</legend>
        {METHODS.slice(0, 5).map((m) => (
          <label key={m} className="route-chip">
            <input
              type="checkbox"
              checked={match.methods?.includes(m) ?? false}
              data-testid={`${testId}-method-${m}`}
              onChange={() => toggleMethod(m)}
            />
            {m}
          </label>
        ))}
        {!match.methods && <span className="insp-note">{t("routing.anyMethod")}</span>}
      </fieldset>
      <div className="insp-row2">
        <label className="insp-field">
          <span className="insp-label">{t("routing.pathMatch")}</span>
          <select
            className="insp-input"
            value={kind}
            data-testid={`${testId}-kind`}
            onChange={(e) => {
              const k = e.currentTarget.value as PathMatchKind | "any";
              const next = { ...match };
              if (k === "any") delete next.path;
              else next.path = { kind: k, value: match.path?.value ?? "/" };
              commit(next);
            }}
          >
            <option value="any">{t("routing.anyPath")}</option>
            <option value="exact">{t("routing.exact")}</option>
            <option value="prefix">{t("routing.prefix")}</option>
            <option value="template">{t("routing.template")}</option>
          </select>
        </label>
        {match.path && (
          <label className="insp-field">
            <span className="insp-label">{t("routing.path")}</span>
            <input
              className="insp-input mono"
              value={draft.value ?? match.path.value}
              spellCheck={false}
              aria-invalid={!!problem}
              data-testid={`${testId}-path`}
              onChange={(e) => {
                const value = e.currentTarget.value;
                commit({ ...match, path: { kind: match.path!.kind, value } }, { value });
              }}
            />
          </label>
        )}
      </div>
      {problem && (
        <small className="insp-note" role="status" data-testid={`${testId}-problem`}>
          {problem}
        </small>
      )}
      <ReadoutDisclosure testId={`${testId}-advanced`} title={t("routing.matchMore")}>
        <label className="insp-field">
          <span className="insp-label">{t("routing.hosts")}</span>
          <input
            className="insp-input mono"
            value={draft.hosts ?? (match.hosts ?? []).join(", ")}
            // eslint-disable-next-line local/no-literal-ui-text -- an example value in the HTTP grammar, never translated
            placeholder="api.example.com"
            spellCheck={false}
            data-testid={`${testId}-hosts`}
            onChange={(e) => {
              const text = e.currentTarget.value;
              const hosts = text
                .split(",")
                .map((h) => h.trim())
                .filter(Boolean);
              const next = { ...match };
              if (hosts.length) next.hosts = hosts;
              else delete next.hosts;
              commit(next, { hosts: text });
            }}
          />
        </label>
        <label className="insp-field">
          <span className="insp-label">{t("routing.headers")}</span>
          <textarea
            className="insp-input mono"
            rows={2}
            dir="ltr"
            value={draft.headers ?? entriesText(match.headers, ":")}
            // eslint-disable-next-line local/no-literal-ui-text -- an example value in the HTTP grammar, never translated
            placeholder="X-Tenant: blue"
            spellCheck={false}
            data-testid={`${testId}-headers`}
            onChange={(e) => {
              const text = e.currentTarget.value;
              try {
                const headers = parseEntries(text, ":");
                const next = { ...match };
                if (headers) next.headers = headers;
                else delete next.headers;
                commit(next, { headers: text });
              } catch (error) {
                setDraft({ headers: text });
                setProblem(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        </label>
        <label className="insp-field">
          <span className="insp-label">{t("routing.query")}</span>
          <textarea
            className="insp-input mono"
            rows={2}
            dir="ltr"
            value={draft.query ?? entriesText(match.query, "=")}

            placeholder="v=2"
            spellCheck={false}
            data-testid={`${testId}-query`}
            onChange={(e) => {
              const text = e.currentTarget.value;
              try {
                const query = parseEntries(text, "=");
                const next = { ...match };
                if (query) next.query = query;
                else delete next.query;
                commit(next, { query: text });
              } catch (error) {
                setDraft({ query: text });
                setProblem(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        </label>
      </ReadoutDisclosure>
    </div>
  );
}

/** Send to: each outgoing connection with a weight (0 never wins); at least one stays positive. */
function TargetsEditor({
  action,
  edges,
  onChange,
  testId,
}: {
  action: RouteAction;
  edges: { id: string; label: string }[];
  onChange: (a: RouteAction) => void;
  testId: string;
}) {
  const total = action.targets.reduce((s, x) => s + x.weight, 0);
  return (
    <fieldset className="route-targets" data-testid={testId}>
      <legend className="insp-label">{t("routing.sendTo")}</legend>
      {edges.map((edge) => {
        const target = action.targets.find((x) => x.edgeId === edge.id);
        const share = target && total ? Math.round((target.weight / total) * 100) : 0;
        return (
          <div className="route-target" key={edge.id}>
            <label className="insp-check">
              <input
                type="checkbox"
                checked={!!target}
                disabled={!!target && action.targets.length === 1}
                data-testid={`${testId}-${edge.id}`}
                onChange={(e) => onChange(setTarget(action, edge.id, e.currentTarget.checked ? 1 : undefined))}
              />
              <span>{edge.label}</span>
            </label>
            {target && (
              <input
                className="insp-input mono route-weight"
                type="number"
                min={0}
                max={10000}
                step={1}
                value={target.weight}
                aria-label={t("routing.weightOf", { target: edge.label })}
                data-testid={`${testId}-${edge.id}-weight`}
                onChange={(e) => {
                  const v = e.currentTarget.valueAsNumber;
                  if (!Number.isInteger(v) || v < 0 || v > 10000) return;
                  const next = setTarget(action, edge.id, v);
                  if (next.targets.some((x) => x.weight > 0)) onChange(next);
                }}
              />
            )}
            {target && <span className="insp-note route-share">{share}%</span>}
          </div>
        );
      })}
      <p className="insp-note">{t("routing.weightsHint")}</p>
    </fieldset>
  );
}

const ruleRate = (action: RouteAction) => {
  const q = action.quotas?.find((x) => x.id === "rate-limit");
  return q ? (q.amount * 1000) / q.windowMs : undefined;
};
const withRate = (action: RouteAction, rate: number | undefined): RouteAction => {
  const quotas = (action.quotas ?? []).filter((q) => q.id !== "rate-limit");
  if (rate !== undefined)
    quotas.push({ id: "rate-limit", unit: "requests", amount: rate, windowMs: 1000, algorithm: "token-bucket" });
  const next = { ...action };
  if (quotas.length) next.quotas = quotas;
  else delete next.quotas;
  return next;
};

/** A route quota (a gateway's rate-limiting plugin): requests per second for one rule, refused 429 above it. */
function RateLimitField({
  action,
  onChange,
  testId,
}: {
  action: RouteAction;
  onChange: (a: RouteAction) => void;
  testId: string;
}) {
  const rate = ruleRate(action);
  return (
    <label className="insp-field">
      <span className="insp-label">{t("routing.rateLimit")}</span>
      <input
        className="insp-input mono"
        type="number"
        min={0.001}
        step="any"
        value={rate ?? ""}
        placeholder={t("routing.noLimit")}
        data-testid={testId}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          if (raw === "") onChange(withRate(action, undefined));
          else if (e.currentTarget.validity.valid && e.currentTarget.valueAsNumber > 0)
            onChange(withRate(action, e.currentTarget.valueAsNumber));
        }}
      />
    </label>
  );
}

function TargetSummary({
  labels,
  summaries,
}: {
  labels: string[];
  summaries: ReturnType<typeof createTargetSummaries>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const full = labels.join(", ");
  const short = labels.length > 1 ? t("routing.moreTargets", { target: labels[0], count: labels.length - 1 }) : full;
  useLayoutEffect(() => {
    return summaries.add(ref.current!, full, short);
  }, [full, short, summaries]);
  return (
    <span className="route-target-summary" data-testid="route-target-summary" ref={ref}>
      {full}
    </span>
  );
}

export function RouteTableFields({
  editor,
  nodeId,
  props,
  planning,
}: {
  editor: EditorApi;
  nodeId: string;
  props: Record<string, unknown>;
  planning: PlanningModel | undefined;
}) {
  useLocale();
  const [summaries] = useState(createTargetSummaries);
  const intent = routingIntent.peek(nodeId);
  const intentSerial = routingIntent.serial(nodeId);
  const [open, setOpen] = useState<string | null>(() => (intent === "default" ? "default" : null));
  const defaultRow = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (routingIntent.clear(nodeId, intentSerial) && intent === "default") defaultRow.current?.focus();
  }, [nodeId, intentSerial, intent]);
  const [announce, setAnnounce] = useState("");
  const table = props.routeTable as RouteTable | undefined;
  const doc = editor.getDiagram();
  const edges = table ? connectionLabels(doc, nodeId) : [];
  const labelOf = (id: string) => edges.find((e) => e.id === id)?.label ?? id;
  const merge = (field: string) => ({ merge: `routing:table:${nodeId}:${field}` });
  const save = (next: RouteTable, field: string) => editor.setNodeProps(nodeId, { routeTable: next }, merge(field));
  if (!revisionAtLeast(planning?.revision, "p3-a1")) return null;
  if (!table)
    return (
      <div className="route-empty" data-testid="routes-empty">
        <button
          type="button"
          className="btn"
          data-testid="routes-add"
          onClick={() => {
            if (applyRouted(editor, (d) => setProps(d, nodeId, { routeTable: firstTable(outgoingFlows(d, nodeId)) })))
              setOpen("default");
          }}
        >
          {t("routing.addRoutes")}
        </button>
        <p className="insp-note">{t("routing.addRoutesHint")}</p>
      </div>
    );
  const shadowed = shadowedRules(table);
  const move = (rule: RouteRule, delta: -1 | 1) => {
    const next = moveRule(table, rule.id, delta);
    if (next === table) return;
    save(next, `move:${rule.id}`);
    const at = next.rules.findIndex((r) => r.id === rule.id);
    setAnnounce(t("routing.movedTo", { position: at + 1, count: next.rules.length }));
  };
  const rowKeys = (rule: RouteRule) => (e: KeyboardEvent) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(rule, e.key === "ArrowUp" ? -1 : 1);
    }
  };
  const fallback = table.default;
  return (
    <div className="route-table-section" data-testid="routes">
      <div
        className="route-table route-rules-table"
        role="group"
        aria-label={t("routing.tableLabel")}
        data-testid="routes-table"
      >
        <div className="route-row route-head" aria-hidden="true">
          <span data-testid="routes-order-heading">{t("routing.order")}</span>
          <span data-testid="routes-match-heading">{t("routing.match")}</span>
          <span>{t("routing.sendTo")}</span>
          <span>{t("routing.split")}</span>
        </div>
        {table.rules.map((rule, i) => (
          <div key={rule.id} className={open === rule.id ? "route-open" : undefined}>
            <button
              type="button"
              className="route-row"
              aria-expanded={open === rule.id}
              aria-label={t("routing.ruleRow", {
                n: i + 1,
                match: matchText(rule.match),
                targets: rule.targets.map((x) => labelOf(x.edgeId)).join(", "),
                split: splitText(rule),
              })}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              ref={(el) => {
                if (el) rowRefs.current.set(rule.id, el);
                else rowRefs.current.delete(rule.id);
              }}
              data-testid={`routes-rule-${rule.id}`}
              onClick={() => setOpen(open === rule.id ? null : rule.id)}
              onKeyDown={rowKeys(rule)}
            >
              <span>{i + 1}</span>
              <span
                className="mono route-cut"
                data-testid={`routes-rule-${rule.id}-match`}
                title={rule.label ? `${rule.label}: ${matchText(rule.match)}` : matchText(rule.match)}
              >
                {matchText(rule.match)}
              </span>
              <span
                className="route-cut"
                data-testid={`routes-rule-${rule.id}-targets`}
                title={rule.targets.map((x) => labelOf(x.edgeId)).join(", ")}
              >
                <TargetSummary labels={rule.targets.map((x) => labelOf(x.edgeId))} summaries={summaries} />
              </span>
              <span className="mono route-split">{splitText(rule)}</span>
            </button>
            {shadowed.has(i) && (
              <p className="insp-note route-warning" data-testid={`routes-shadowed-${rule.id}`}>
                {t("routing.shadowed", { rule: i + 1, by: shadowed.get(i)! + 1 })}
              </p>
            )}
            {open === rule.id && (
              <div className="route-details" data-testid={`routes-rule-${rule.id}-details`}>
                <label className="insp-field">
                  <span className="insp-label">{t("routing.ruleName")}</span>
                  <input
                    className="insp-input"
                    value={rule.label ?? ""}
                    placeholder={t("routing.optional")}
                    data-testid={`routes-rule-${rule.id}-label`}
                    onChange={(e) =>
                      save(
                        updateRule(table, rule.id, { label: e.currentTarget.value || undefined }),
                        `label:${rule.id}`,
                      )
                    }
                  />
                </label>
                <MatchEditor
                  match={rule.match}
                  testId={`routes-rule-${rule.id}-match`}
                  onChange={(match) => save(updateRule(table, rule.id, { match }), `match:${rule.id}`)}
                />
                <TargetsEditor
                  action={rule}
                  edges={edges}
                  testId={`routes-rule-${rule.id}-targets`}
                  onChange={(a) => save(updateRule(table, rule.id, { targets: a.targets }), `targets:${rule.id}`)}
                />
                <ReadoutDisclosure testId={`routes-rule-${rule.id}-quota`} title={t("routing.rateLimitFold")}>
                  <RateLimitField
                    action={rule}
                    testId={`routes-rule-${rule.id}-rate`}
                    onChange={(a) => save(updateRule(table, rule.id, { quotas: a.quotas }), `rate:${rule.id}`)}
                  />
                </ReadoutDisclosure>
                <div className="route-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={i === 0}
                    data-testid={`routes-rule-${rule.id}-up`}
                    onClick={() => move(rule, -1)}
                  >
                    {t("routing.moveUp")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={i === table.rules.length - 1}
                    data-testid={`routes-rule-${rule.id}-down`}
                    onClick={() => move(rule, 1)}
                  >
                    {t("routing.moveDown")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    data-testid={`routes-rule-${rule.id}-delete`}
                    onClick={() => {
                      save(removeRule(table, rule.id), `delete:${rule.id}`);
                      setOpen(null);
                      const next = table.rules[i + 1]?.id ?? table.rules[i - 1]?.id;
                      requestAnimationFrame(() => (next ? rowRefs.current.get(next) : defaultRow.current)?.focus());
                      setAnnounce(t("routing.ruleRemoved", { rule: i + 1 }));
                      notify(t("routing.ruleDeleted", { rule: i + 1 }), {
                        action: {
                          label: t("routing.undo"),
                          run: () => editor.undo(),
                          testId: "toast-rule-undo",
                          undoes: true,
                        },
                      });
                    }}
                  >
                    {t("routing.deleteRule")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div className={open === "default" ? "route-open" : undefined}>
          <button
            type="button"

            ref={defaultRow}
            className="route-row route-default"
            aria-expanded={open === "default"}
            aria-label={
              fallback
                ? t("routing.defaultRow", {
                    targets: fallback.targets.map((x) => labelOf(x.edgeId)).join(", "),
                    split: splitText(fallback),
                  })
                : undefined
            }
            data-testid="routes-default"
            onClick={() => setOpen(open === "default" ? null : "default")}
          >
            <span data-testid="routes-last">{t("routing.last")}</span>
            <span>{t("routing.default")}</span>
            <span
              className="route-cut"
              title={fallback ? fallback.targets.map((x) => labelOf(x.edgeId)).join(", ") : undefined}
            >
              {fallback ? (
                <TargetSummary labels={fallback.targets.map((x) => labelOf(x.edgeId))} summaries={summaries} />
              ) : (
                t("routing.reject404")
              )}
            </span>
            <span className="mono route-split">{fallback ? splitText(fallback) : "—"}</span>
          </button>
          {open === "default" && (
            <div className="route-details" data-testid="routes-default-details">
              <label className="insp-check">
                <input
                  type="radio"
                  name={`default-${nodeId}`}
                  checked={!fallback}
                  data-testid="routes-default-reject"
                  onChange={() => {
                    const next = { ...table };
                    delete next.default;
                    save(next, "default");
                  }}
                />
                <span>
                  {t("routing.reject404")}
                  <small>{t("routing.rejectHint")}</small>
                </span>
              </label>
              <label className="insp-check">
                <input
                  type="radio"
                  name={`default-${nodeId}`}
                  checked={!!fallback}
                  disabled={!edges.length}
                  data-testid="routes-default-forward"
                  onChange={() => save({ ...table, default: firstTable(edges.map((e) => e.id)).default }, "default")}
                />
                <span>{t("routing.forward")}</span>
              </label>
              {fallback && (
                <TargetsEditor
                  action={fallback}
                  edges={edges}
                  testId="routes-default-targets"
                  onChange={(a) => save({ ...table, default: { ...fallback, targets: a.targets } }, "default:targets")}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <div role="status" aria-live="polite" className="sr-only" data-testid="routes-announce">
        {announce}
      </div>
      <div className="route-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!edges.length}
          data-testid="routes-add-rule"
          onClick={() => {
            const added = addRule(
              table,
              { methods: ["GET"], path: { kind: "prefix", value: "/" } },
              edges.slice(0, 1).map((e) => e.id),
            );
            save(added.table, `add:${added.id}`);
            setOpen(added.id);
            setAnnounce(t("routing.ruleAdded", { rule: added.table.rules.length }));
          }}
        >
          {t("routing.addRule")}
        </button>
        <button
          type="button"
          className="link-btn"
          data-testid="routes-remove"
          onClick={() => {
            editor.setNodeProps(nodeId, { routeTable: undefined });
            notify(t("routing.tableRemoved"), {
              action: { label: t("routing.undo"), run: () => editor.undo(), testId: "toast-routes-undo", undoes: true },
            });
          }}
        >
          {t("routing.removeTable")}
        </button>
      </div>
      {!edges.length && <p className="insp-note">{t("routing.noConnections")}</p>}
    </div>
  );
}

/** A router's outgoing connections named by their target (two to one node add their own label): linear passes. */
function connectionLabels(doc: Doc, nodeId: string): { id: string; label: string }[] {
  const ids = new Set(outgoingFlows(doc, nodeId));
  const flows = doc.edges.filter((e) => ids.has(e.id));
  const names = new Map(doc.nodes.map((n) => [n.id, n.label]));
  const perTarget = new Map<string, number>();
  for (const e of flows) perTarget.set(e.to, (perTarget.get(e.to) ?? 0) + 1);
  return flows.map((e) => {
    const to = names.get(e.to) ?? e.to;
    return { id: e.id, label: (perTarget.get(e.to) ?? 0) > 1 && e.label ? `${to} · ${e.label}` : to };
  });
}

function setProps(d: DiagramFile, nodeId: string, patch: Record<string, unknown>): void {
  const node = d.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const props = { ...node.props, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) Reflect.deleteProperty(props, k);
  node.props = props;
}

// ---------------------------------------------------------------- traffic mix

export function TrafficMixFields({
  editor,
  nodeId,
  props,
  planning,
}: {
  editor: EditorApi;
  nodeId: string;
  props: Record<string, unknown>;
  planning: PlanningModel | undefined;
}) {
  useLocale();
  const mix = props.trafficMix as TrafficMix | undefined;
  const routes = planning?.requestRoutes ?? [];
  const intent = routingIntent.peek(nodeId);
  const intentSerial = routingIntent.serial(nodeId);
  // A right-click "Add traffic mix…" opens straight onto the new route's form.
  const [adding, setAdding] = useState(() => intent === "new-route");
  const [intended] = useState(adding);
  useEffect(() => {
    routingIntent.clear(nodeId, intentSerial);
  }, [nodeId, intentSerial]);
  const [choosing, setChoosing] = useState(false);
  // Keyboard position after choosing from Add route: the new form's Path, or the added row's value.
  const [focusNew, setFocusNew] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(() => {
    return typeof intent === "object" ? intent.focusRow : null;
  });
  const valueRefs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    const input = focusRow ? valueRefs.current.get(focusRow) : undefined;
    if (!input) return;
    input.focus();
    setFocusRow(null);
  }, [focusRow, props.trafficMix]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const merge = (field: string) => ({ merge: `routing:mix:${nodeId}:${field}` });
  const save = (next: TrafficMix | undefined, field: string) =>
    editor.setNodeProps(nodeId, { trafficMix: next }, merge(field));
  if (!revisionAtLeast(planning?.revision, "p3-a1")) return null;
  const rate = typeof props.ratePerSec === "number" ? props.ratePerSec : 2;
  const addNew = (address: RequestAddress, label?: string) => {
    applyRouted(editor, (d) => {
      const added = addRoute(d.planning!.requestRoutes ?? [], address, label);
      d.planning = { ...d.planning!, requestRoutes: added.routes };
      const node = d.nodes.find((n) => n.id === nodeId)!;
      setProps(d, nodeId, { trafficMix: addMixRow(node.props?.trafficMix as TrafficMix | undefined, added.id) });
    });
    setAdding(false);
    setDraft(null);
  };
  const unused = routes.filter((r) => !mix?.entries.some((e) => e.routeId === r.id));
  const adder = adding ? (
    <NewRoute
      testId="mix-new-route"
      onAdd={addNew}
      onCancel={() => {
        setAdding(false);
        setFocusNew(false);
      }}
      focus={intended || focusNew}
    />
  ) : (
    <div className="route-actions route-adder">
      <button
        type="button"
        className="btn btn-primary"
        aria-expanded={unused.length ? choosing : undefined}
        data-testid={unused.length ? "mix-add-route" : "mix-add-route-new"}
        onClick={() => {
          if (unused.length) setChoosing(!choosing);
          else {
            setAdding(true);
            setFocusNew(true);
          }
        }}
      >
        {mix ? t("routing.addRoute") : t("routing.addMix")}
      </button>
      {choosing && unused.length > 0 && (
        <ul className="route-choices" data-testid="mix-add-route-choices">
          {unused.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="link-btn"
                data-testid={`mix-add-route-${r.id}`}
                onClick={() => {
                  setChoosing(false);
                  setDraft(null);
                  setFocusRow(r.id);
                  if (mix) save(addMixRow(mix, r.id), `add:${r.id}`);
                  else {
                    // The first row moves the mix into its own section: the fields there take the focus over.
                    routingIntent.set(nodeId, { focusRow: r.id });
                    applyRouted(editor, (d) => setProps(d, nodeId, { trafficMix: addMixRow(undefined, r.id) }));
                  }
                }}
              >
                <RouteSwatch route={r} /> {routeName(r)}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="link-btn"
              data-testid="mix-add-route-new"
              onClick={() => {
                setChoosing(false);
                setAdding(true);
                setFocusNew(true);
              }}
            >
              {t("routing.newRouteMenu")}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
  if (!mix)
    return (
      <div className="route-empty" data-testid="mix-empty">
        {adder}
        <p className="insp-note">{t("routing.addMixHint")}</p>
      </div>
    );
  const shares = mix.mode === "shares";
  const values = mix.entries.map((e) =>
    shares
      ? Math.round(((draft?.[e.routeId] ?? (e as { share: number }).share * 100) + Number.EPSILON) * 1000) / 1000
      : (e as { ratePerSec: number }).ratePerSec,
  );
  const sum = values.reduce((a, b) => a + b, 0);
  const total = shares ? rate : sum;
  const off = shares && Math.abs(sum - 100) > 1e-6;
  const switchMode = (m: "shares" | "rates") => {
    if (mix.mode === m) return;
    setDraft(null);
    // Rates → shares: the rows' total becomes the source's Rate, so the traffic stays what it was.
    if (m === "shares")
      editor.setNodeProps(nodeId, { trafficMix: switchMixMode(mix, rate), ratePerSec: sum }, merge("mode"));
    else save(switchMixMode(mix, rate), "mode");
  };
  const setShare = (routeId: string, percent: number) => {
    const next = {
      ...(draft ?? Object.fromEntries(mix.entries.map((e) => [e.routeId, (e as { share: number }).share * 100]))),
      [routeId]: percent,
    };
    const nextSum = Object.values(next).reduce((a, b) => a + b, 0);
    if (Math.abs(nextSum - 100) < 1e-6) {
      setDraft(null);
      const entries = mix.entries.map((e) => ({ routeId: e.routeId, share: next[e.routeId] / 100 }));
      save(normalizeShares({ mode: "shares", entries }), `share`);
    } else setDraft(next);
  };
  return (
    <div className="route-mix" data-testid="mix">
      <div className="insp-field">
        <span className="insp-label">{t("routing.mixMode")}</span>
        <div className="segmented insp-seg" role="radiogroup" aria-label={t("routing.mixMode")} data-testid="mix-mode">
          {(["shares", "rates"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mix.mode === m}
              tabIndex={mix.mode === m ? 0 : -1}
              className={mix.mode === m ? "is-on" : ""}
              data-testid={`mix-mode-${m}`}
              onClick={() => switchMode(m)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const other = m === "shares" ? "rates" : "shares";
                const next = e.key === "Home" ? "shares" : e.key === "End" ? "rates" : other;
                switchMode(next);
                e.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[data-testid="mix-mode-${next}"]`)
                  ?.focus();
              }}
            >
              {m === "shares" ? t("routing.shares") : t("routing.rates")}
            </button>
          ))}
        </div>
      </div>
      <p className="insp-note" data-testid="mix-total">
        {shares
          ? t("routing.totalShares", { rate: explanationRate(total, "req/s") })
          : t("routing.totalRates", { rate: explanationRate(total, "req/s") })}
      </p>
      <div className="route-table route-mix-table" role="group" aria-label={t("routing.mixLabel")}>
        <div className="route-row route-head" aria-hidden="true">
          <span>{t("routing.route")}</span>
          <span>{shares ? t("routing.share") : t("routing.rate")}</span>
          <span>
            <span className="sr-only">{t("routing.actions")}</span>
          </span>
        </div>
        {mix.entries.map((entry, i) => {
          const route = routes.find((r) => r.id === entry.routeId);
          return (
            <div key={entry.routeId}>
              <div className="route-row" data-testid={`mix-row-${entry.routeId}`}>
                <span className="route-name">
                  {route && <RouteSwatch route={route} />}
                  <button
                    type="button"
                    className="link-btn"
                    aria-expanded={editing === entry.routeId}
                    title={route ? `${addressText(route.address)} · ${lookText(route)}` : entry.routeId}
                    data-testid={`mix-row-${entry.routeId}-edit`}
                    onClick={() => setEditing(editing === entry.routeId ? null : entry.routeId)}
                  >
                    {route ? routeName(route) : entry.routeId}
                  </button>
                </span>
                <span>
                  <input
                    className="insp-input mono route-weight"
                    type="number"
                    min={0}
                    max={shares ? 100 : 10_000_000}
                    step="any"
                    value={values[i]}
                    aria-label={
                      shares
                        ? t("routing.shareOf", { route: route ? routeName(route) : entry.routeId })
                        : t("routing.rateOf", { route: route ? routeName(route) : entry.routeId })
                    }
                    data-testid={`mix-row-${entry.routeId}-value`}
                    ref={(el) => {
                      if (el) valueRefs.current.set(entry.routeId, el);
                      else valueRefs.current.delete(entry.routeId);
                    }}
                    onChange={(e) => {
                      const v = e.currentTarget.valueAsNumber;
                      if (!Number.isFinite(v) || v < 0) return;
                      if (shares) setShare(entry.routeId, Math.min(100, v));
                      else
                        save(
                          {
                            mode: "rates",
                            entries: mix.entries.map((x) =>
                              x.routeId === entry.routeId ? { ...x, ratePerSec: v } : x,
                            ) as { routeId: string; ratePerSec: number }[],
                          },
                          `rate:${entry.routeId}`,
                        );
                    }}
                  />
                </span>
                <span>
                  <button
                    type="button"
                    className="icon-btn insp-mini"
                    title={t("routing.removeRow")}
                    aria-label={t("routing.removeRowOf", { route: route ? routeName(route) : entry.routeId })}
                    data-testid={`mix-row-${entry.routeId}-remove`}
                    onClick={() => {
                      setDraft(null);
                      save(removeMixRow(mix, entry.routeId), `remove:${entry.routeId}`);
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
              {editing === entry.routeId && route && <RouteDefinition editor={editor} route={route} />}
            </div>
          );
        })}
      </div>
      {off && (
        <p className="insp-note route-warning" role="status" data-testid="mix-off">
          {t("routing.sharesOff", { sum: formatNumber(sum, { maximumFractionDigits: 2 }) })}{" "}
          <button
            type="button"
            className="link-btn"
            data-testid="mix-normalize"
            onClick={() => {
              const entries = mix.entries.map((e, i) => ({ routeId: e.routeId, share: values[i] / 100 }));
              setDraft(null);
              save(normalizeShares({ mode: "shares", entries }), "normalize");
            }}
          >
            {t("routing.normalize")}
          </button>
        </p>
      )}
      {adder}
      <button
        type="button"
        className="link-btn"
        data-testid="mix-remove"
        onClick={() => {
          setDraft(null);
          editor.setNodeProps(nodeId, { trafficMix: undefined });
          notify(t("routing.mixRemoved"), {
            action: { label: t("routing.undo"), run: () => editor.undo(), testId: "toast-mix-undo", undoes: true },
          });
        }}
      >
        {t("routing.removeMix")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- connections

/** A Request out of a source or service: an optional request route it calls; a router's connections: its rules. */
export function EdgeRouteFields({
  editor,
  edgeId,
  planning,
  caller,
}: {
  editor: EditorApi;
  edgeId: string;
  planning: PlanningModel | undefined;
  /** A Request out of a source or service (where an explicit address applies). */
  caller: boolean;
}) {
  useLocale();
  if (!routingEnabled(planning)) return null;
  const d = editor.getDiagram();
  const edge = d.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const routes = planning!.requestRoutes ?? [];
  const router = d.nodes.find((n) => n.id === edge.from);
  const table = router?.props?.routeTable as RouteTable | undefined;
  const rules = (table?.rules ?? [])
    .filter((r) => r.targets.some((x) => x.edgeId === edgeId))
    .map((r, i) => r.label ?? `${i + 1}. ${matchText(r.match)}`);
  if (table?.default?.targets.some((x) => x.edgeId === edgeId)) rules.push(t("routing.default"));
  const current = edge.props?.requestRouteId as string | undefined;
  return (
    <>
      {caller && (
        <label className="insp-field">
          <span className="insp-label">{t("routing.callsRoute")}</span>
          <select
            className="insp-input"
            value={current ?? ""}
            data-testid="edge-request-route"
            onChange={(e) => editor.setEdgeProps(edgeId, { requestRouteId: e.currentTarget.value || undefined })}
          >
            <option value="">{t("routing.noAddress")}</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {routeName(r)} · {addressText(r.address)}
              </option>
            ))}
          </select>
        </label>
      )}
      {table && (
        <p className="insp-note" data-testid="edge-routes">
          {rules.length
            ? t("routing.edgeRules", { count: rules.length, rules: rules.join(", ") })
            : t("routing.edgeNoRules")}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- diagram: definitions and the live legend

const VISIBLE = 7;

/**
 * The diagram's request routes. Editing: each definition, its address and where it's used. Live: the Routes legend
 * (swatch, marker and address, with each route's counts in real units), seven at a time with a search for the rest.
 */
export function RequestRoutesSection({
  editor,
  planning,
  place,
}: {
  editor: EditorApi;
  planning: PlanningModel | undefined;
  /** "live": the legend, first in the panel while live; "edit": the definitions, after the diagram's fields. */
  place: "live" | "edit";
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  const state = useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const routes = useMemo(() => planning?.requestRoutes ?? [], [planning]);
  if (!routingEnabled(planning) || !routes.length || (place === "live") !== !!live) return null;
  const counts = (state?.snapshot as { routes?: Record<string, RouteCounts> } | undefined)?.routes;
  const q = query.trim().toLowerCase();
  const matching = routes.filter((r) => !q || `${routeName(r)} ${addressText(r.address)}`.toLowerCase().includes(q));
  const shown = all || q ? matching : matching.slice(0, VISIBLE);
  return (
    <section className="insp-section" aria-label={t("routing.routesHeading")} data-testid="request-routes">
      <h3>{t("routing.routesHeading")}</h3>
      {routes.length > VISIBLE && (
        <input
          className="insp-input"
          type="search"
          value={query}
          placeholder={t("routing.search")}
          aria-label={t("routing.search")}
          data-testid="request-routes-search"
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      )}
      <ul className="route-legend" data-testid="request-routes-list">
        {shown.map((route) => {
          const c = counts?.[route.id];
          const text = c
            ? t("routing.counts", {
                sent: formatNumber(c.sent),
                done: formatNumber(c.completed),
                refused: formatNumber(c.rejected),
              })
            : undefined;
          return (
            <li key={route.id} data-testid={`request-route-${route.id}`}>
              {live ? (
                <div
                  className="route-legend-row is-static"
                  role="group"
                  aria-label={`${routeName(route)}, ${addressText(route.address)}, ${lookText(route)}${text ? `. ${text}` : ""}`}
                  data-testid={`request-route-${route.id}-row`}
                >
                  <RouteSwatch route={route} size={14} />
                  <span className="route-legend-name">{routeName(route)}</span>
                  <span className="route-legend-address mono">{addressText(route.address)}</span>
                  {text && <span className="route-legend-counts mono">{text}</span>}
                </div>
              ) : (
                <button
                  type="button"
                  className="route-legend-row"
                  aria-expanded={open === route.id}
                  aria-label={`${routeName(route)}, ${addressText(route.address)}, ${lookText(route)}`}
                  data-testid={`request-route-${route.id}-row`}
                  onClick={() => setOpen(open === route.id ? null : route.id)}
                >
                  <RouteSwatch route={route} size={14} />
                  <span className="route-legend-name">{routeName(route)}</span>
                  <span className="route-legend-address mono">{addressText(route.address)}</span>
                </button>
              )}
              {!live && open === route.id && <RouteDefinition editor={editor} route={route} deletable />}
            </li>
          );
        })}
      </ul>
      {!all && !q && matching.length > VISIBLE && (
        <button type="button" className="link-btn" data-testid="request-routes-more" onClick={() => setAll(true)}>
          {t("routing.showAll", { count: matching.length })}
        </button>
      )}
      {live && <p className="insp-note">{t("routing.legendUnits")}</p>}
    </section>
  );
}

const noSubscribe = () => () => {};
const noState = () => undefined;

/** A small wrapper for places that only need children when routing is on. */
export function WhenRouted({ planning, children }: { planning: PlanningModel | undefined; children: ReactNode }) {
  return routingEnabled(planning) ? <>{children}</> : null;
}
