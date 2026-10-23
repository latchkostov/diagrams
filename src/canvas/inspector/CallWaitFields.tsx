import { RequestGroup } from "./RequestGroup";
import { revisionAtLeast } from "../../model/revisions";
import { RetryFields } from "./RetryFields";
import { BreakerFields } from "./BreakerFields";
import { Disclosure } from "./Disclosure";
import { Dropdown } from "../../components/Dropdown";
import { Field } from "./fields";
import { SimInput } from "./SimulationFields";
import { SIM_LIMITS } from "../../model/simLimits";
import { t } from "../../i18n";
import type { EditorApi } from "../../editor/types";
import { effectiveCallerPolicy } from "../../editor/callerPolicy";
import { planningHost } from "../../live/planningHost";
import { useSyncExternalStore } from "react";
import { stencilRole } from "../../stencils/roles";
import { callPolicy } from "../../sim/callPolicy";

const noSubscribe = () => () => {};
const noState = () => null;

/** Call controls are part of the inspector chunk: its first keyboard pass includes every field. */
export function CallWaitFields({
  editor,
  edgeId,
  stencil,
}: {
  editor: EditorApi;
  edgeId: string;
  caller: unknown;
  stencil: string;
}) {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const effective = effectiveCallerPolicy(editor, edgeId, live);
  if (!effective?.editable) return null;
  const { caller, policy, set, override, diagramCaller } = effective;
  const origin = (key: keyof NonNullable<typeof caller>) => {
    if (!override || !Object.hasOwn(override, key)) return null;
    const base = diagramCaller?.[key];
    const value =
      key === "breaker"
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
      <Field label={t("threads.whileWaiting")}>
        <Dropdown
          value={policy.blocking ? "blocking" : "non-blocking"}
          items={[
            { value: "blocking", label: t("threads.holds") },
            { value: "non-blocking", label: t("threads.frees") },
          ]}
          onChange={(wait) => set({ wait: wait as "blocking" | "non-blocking" })}
          testId="inspector-field-wait"
          aria-label={t("threads.whileWaiting")}
        />
      </Field>
      <p className="insp-note" data-testid="inspector-hint-wait">
        {t("threads.waitHint")}
      </p>
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
        <CallAdvanced enabled={revisionAtLeast(editor.getDiagram().planning?.revision, "p3-w2")}>
          <SimInput
            visibleHint
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
      {revisionAtLeast(editor.getDiagram().planning?.revision, "p3-w2") && (
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
      {revisionAtLeast(editor.getDiagram().planning?.revision, "p3-w2") && (
        <BreakerFields breaker={caller.breaker} origin={origin("breaker")} set={(breaker) => set({ breaker })} />
      )}
    </>
  );
}

function CallAdvanced({ enabled, children }: { enabled: boolean; children: import("react").ReactNode }) {
  return enabled ? (
    <Disclosure id="call-advanced" title={t("resilience.poolDetails")} description={t("threads.poolHint")}>
      {children}
    </Disclosure>
  ) : (
    <>{children}</>
  );
}
