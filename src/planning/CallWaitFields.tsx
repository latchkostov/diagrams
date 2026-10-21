import { Dropdown } from "../components/Dropdown";
import { Field } from "../canvas/inspector/fields";
import { SimInput } from "../canvas/inspector/SimulationFields";
import { SIM_LIMITS } from "../model/simLimits";
import { t } from "../i18n";
import type { EditorApi } from "../editor/types";
import { effectiveCallerPolicy } from "../editor/callerPolicy";
import { planningHost } from "./host";
import { useSyncExternalStore } from "react";
import { stencilRole } from "../stencils/roles";

const noSubscribe = () => () => {};
const noState = () => null;

/** Connection settings load when their disclosure opens, preserving the canvas download budget. */
export function CallWaitFields({
  editor,
  edgeId,
  stencil,
  advanced = false,
}: {
  editor: EditorApi;
  edgeId: string;
  caller: unknown;
  stencil: string;
  advanced?: boolean;
}) {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const effective = effectiveCallerPolicy(editor, edgeId, live);
  if (!effective?.editable) return null;
  const { caller, policy, set } = effective;
  if (!advanced)
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
        <SimInput
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
      </>
    );
  return (
    <>
      <SimInput
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
      {!policy.blocking && stencilRole(stencil) === "processor" && (
        <SimInput
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
    </>
  );
}
