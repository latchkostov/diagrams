import { Dropdown } from "../components/Dropdown";
import { Field } from "../canvas/inspector/fields";
import { SimInput } from "../canvas/inspector/SimulationFields";
import { SIM_LIMITS } from "../model/simLimits";
import { t } from "../i18n";
import type { EditorApi } from "../editor/types";
import type { EdgeSimProps } from "../sim/types";
import { callPolicy } from "../sim/callPolicy";

/** Connection settings load when their disclosure opens, preserving the canvas download budget. */
export function CallWaitFields({
  editor,
  edgeId,
  caller: value,
  stencil,
  advanced = false,
}: {
  editor: EditorApi;
  edgeId: string;
  caller: unknown;
  stencil: string;
  advanced?: boolean;
}) {
  const caller = value as EdgeSimProps["caller"];
  const policy = callPolicy(stencil, caller);
  const set = (patch: EdgeSimProps["caller"]) => editor.setEdgeProps(edgeId, { caller: { ...caller, ...patch } });
  if (!advanced)
    return (
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
    );
  if (policy.blocking) return null;
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
        onChange={(v) => set({ poolConnections: typeof v === "number" ? v : undefined })}
      />
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
    </>
  );
}
