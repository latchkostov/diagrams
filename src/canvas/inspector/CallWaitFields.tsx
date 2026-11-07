import { RequestGroup } from "./RequestGroup";
import { revisionAtLeast } from "../../model/revisions";
import { RetryFields } from "./RetryFields";
import { BreakerFields } from "./BreakerFields";
import { Disclosure } from "./Disclosure";
import { Field, Segmented } from "./fields";
import { SimInput } from "./SimulationFields";
import { SIM_LIMITS } from "../../model/simLimits";
import { t } from "../../i18n";
import type { EditorApi } from "../../editor/types";
import { effectiveCallerPolicy } from "../../editor/callerPolicy";
import { planningHost } from "../../live/planningHost";
import { useSyncExternalStore } from "react";
import { stencilRole } from "../../stencils/roles";
import { callPolicy } from "../../sim/callPolicy";
import { tutorialRoute } from "../../tutorials/route";
import { cacheLookupChoices } from "../../model/cacheAside";
import { cacheEnabled } from "../../model/caching";
import { isolate } from "../../live/bidi";

const noSubscribe = () => () => {};
const noState = () => null;

/** Call controls are part of the inspector chunk: its first keyboard pass includes every field. */
export function CallWaitFields({
  editor,
  edgeId,
  stencil,
  readDiagram,
}: {
  editor: EditorApi;
  edgeId: string;
  caller: unknown;
  stencil: string;
  readDiagram?: () => import("../../model/types").DiagramFile;
}) {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const effective = effectiveCallerPolicy(editor, edgeId, live, readDiagram?.());
  if (!effective?.editable) return null;
  const { caller, policy, set, override, diagramCaller } = effective;
  const advanced = revisionAtLeast(editor.getDiagram().planning?.revision, "p3-w2");
  const diagram = readDiagram?.() ?? editor.getDiagram();
  const choices = cacheLookupChoices(diagram, edgeId);
  const lookup = diagram.edges.find((edge) => edge.id === caller?.onMiss);
  const cache = diagram.nodes.find((node) => node.id === lookup?.to);
  const cacheProps = cache && { ...cache.props, ...live?.controller.getState().running?.setup?.props?.[cache.id] };
  const activeCondition =
    !!caller?.onMiss &&
    !!cache &&
    cacheEnabled(diagram.planning, cache.stencil, stencilRole(cache.stencil), cacheProps?.cache);
  const origin = (key: keyof NonNullable<typeof caller>) => {
    if (!override || !Object.hasOwn(override, key)) return null;
    const base = diagramCaller?.[key];
    const value =
      key === "onMiss"
        ? base
          ? t("cache.onlyMisses", {
              cache: isolate(choices.find((choice) => choice.id === base)?.label ?? String(base)),
            })
          : t("cache.everyRequest")
        : key === "breaker"
          ? base
            ? t("resilience.on")
            : t("resilience.off")
          : key === "retry"
            ? base && typeof base === "object" && "maxAttempts" in base && Number(base.maxAttempts) > 1
              ? t("resilience.attempts", { count: Number(base.maxAttempts) })
              : t("resilience.off")
            : key === "wait"
              ? callPolicy(stencil, diagramCaller).blocking
                ? t("threads.holds")
                : t("threads.frees")
              : base == null
                ? key === "deadlineMs"
                  ? t("threads.noTimeout")
                  : t("threads.uncapped")
                : String(base);
    return (
      <p className="insp-note" data-testid={`call-override-${key}`}>
        {t("threads.simulationOverride", { value })}
      </p>
    );
  };
  return (
    <>
      <Field group label={t("threads.whileWaiting")} testId="inspector-unit-wait">
        <Segmented
          value={policy.blocking ? "blocking" : "non-blocking"}
          options={[
            { value: "blocking", label: t("threads.holds") },
            { value: "non-blocking", label: t("threads.frees") },
          ]}
          onChange={(wait) => set({ wait: wait as "blocking" | "non-blocking" })}
          testId="inspector-field-wait"
          label={t("threads.whileWaiting")}
        />
        <p className="insp-note" data-testid="inspector-hint-wait">
          {t("threads.waitHint")}
        </p>
        <button
          className="link-btn"
          data-testid="inspector-tutorial-waiting"
          onClick={() => tutorialRoute.open("threads-block")}
        >
          {t("tutorials.learnWaiting")}
        </button>
      </Field>
      {origin("wait")}
      <RequestGroup
        name="waiting-limits"
        title={t("resilience.waitingLimits")}
        description={t("resilience.waitingLimitsHint")}
        origin={origin("deadlineMs")}
      >
        <SimInput
          visibleHint
          name="deadlineMs"
          integer
          field={{
            label: t("threads.timeout"),
            kind: "number",
            unit: "ms",
            min: 0,
            max: SIM_LIMITS.timeMs,
            step: 1,
            placeholder: t("threads.noTimeout"),
            hint: t("threads.timeoutHint"),
          }}
          value={caller?.deadlineMs}
          onChange={(v) => {
            if (v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= SIM_LIMITS.timeMs))
              set({ deadlineMs: v as number | undefined });
          }}
        />
        <CallAdvanced
          enabled={advanced}
          conditional={choices.length > 0 || !!caller?.onMiss}
          summary={
            caller?.onMiss
              ? t("cache.onlyMisses", {
                  cache: isolate(choices.find((choice) => choice.id === caller.onMiss)?.label ?? caller.onMiss),
                })
              : !policy.blocking && stencilRole(stencil) === "processor"
                ? t("workspaceInspector.poolSummary", {
                    pool: policy.pool ?? t("threads.uncapped"),
                    duration: policy.replyMs,
                  })
                : t("workspaceInspector.valueSummary", {
                    label: t("threads.pool"),
                    value: String(policy.pool ?? t("threads.uncapped")),
                  })
          }
        >
          {(choices.length > 0 || caller?.onMiss) && (
            <Field label={t("cache.when")} testId="inspector-unit-onMiss" className="insp-field-wide">
              <select
                data-testid="inspector-field-onMiss"
                aria-label={t("cache.when")}
                aria-describedby={activeCondition ? "cache-aside-hint" : undefined}
                value={caller?.onMiss ?? ""}
                onChange={(e) => set({ onMiss: e.target.value || undefined })}
              >
                <option value="">{t("cache.everyRequest")}</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {t("cache.onlyMisses", { cache: isolate(choice.label) })}
                  </option>
                ))}
              </select>
              {activeCondition && (
                <p className="insp-note" id="cache-aside-hint" data-testid="inspector-hint-onMiss">
                  {t("cache.writeBackHint")}
                </p>
              )}
            </Field>
          )}
          {origin("onMiss")}
          {caller?.onMiss && !revisionAtLeast(diagram.planning?.revision, "p3-w3") && (
            <p className="insp-note" data-testid="inspector-onMiss-dormant">
              {t("cache.conditionDormant")}
            </p>
          )}
          <SimInput
            visibleHint={!advanced}
            name="poolConnections"
            field={{
              label: t("threads.pool"),
              kind: "number",
              min: 1,
              max: 10000,
              placeholder: t("threads.uncapped"),
              hint: t("threads.poolHint"),
            }}
            value={caller?.poolConnections}
            onChange={(v) => set({ poolConnections: typeof v === "number" ? Math.round(v) : undefined })}
          />
          {origin("poolConnections")}
          {!policy.blocking && stencilRole(stencil) === "processor" && (
            <SimInput
              visibleHint
              name="replyMs"
              field={{
                label: t("threads.replyHandling"),
                kind: "number",
                unit: "ms",
                min: 0,
                max: SIM_LIMITS.timeMs,
                placeholder: "10",
                hint: t("threads.replyHint"),
              }}
              value={caller?.replyMs}
              onChange={(v) => set({ replyMs: typeof v === "number" ? v : undefined })}
            />
          )}
          {origin("replyMs")}
        </CallAdvanced>
      </RequestGroup>
      {advanced && (
        <RetryFields
          retry={caller.retry}
          origin={origin("retry")}
          method={
            editor
              .getDiagram()
              .planning?.requestRoutes?.find((r) => r.id === editor.getEdge(edgeId)?.props?.requestRouteId)?.address
              .method
          }
          set={(retry) => set({ retry })}
        />
      )}
      {advanced && (
        <BreakerFields breaker={caller.breaker} origin={origin("breaker")} set={(breaker) => set({ breaker })} />
      )}
    </>
  );
}

function CallAdvanced({
  enabled,
  conditional,
  summary,
  children,
}: {
  enabled: boolean;
  conditional: boolean;
  summary: string;
  children: import("react").ReactNode;
}) {
  return enabled ? (
    <Disclosure
      id="call-advanced"
      title={conditional ? t("cache.requestDetails") : t("resilience.poolDetails")}
      description={t("threads.poolHint")}
      summary={summary}
    >
      {children}
    </Disclosure>
  ) : (
    <>{children}</>
  );
}
