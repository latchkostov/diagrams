import { t } from "../../i18n";
import { SIM_LIMITS } from "../../model/simLimits";
import { DEFAULT_TRAVEL_MS } from "../../sim/topology";
import type { DiagramFlowEdge } from "../types";
import { Field, SideSelect } from "./fields";
import { Disclosure } from "./Disclosure";
import { SimInput } from "./SimulationFields";
import type { InspectorProps } from "./types";
import { PropsEditor } from "./lazyPropsEditor";
import { EDGE_KEYS, RULE_KEYS } from "./simFields";

type EdgeAdvancedProps = Pick<InspectorProps, "editor"> & {
  edge: DiagramFlowEdge;
  data: NonNullable<DiagramFlowEdge["data"]>;
  props: Record<string, unknown>;
  flow: boolean;
  rule: boolean;
  merge: (field: string) => { merge: string };
};

export function EdgeAdvanced({ edge, editor, data, props, flow, rule, merge }: EdgeAdvancedProps) {
  return (
    <Disclosure id="edge-advanced" title={t("resilience.appearanceRouting")}>
      <div className="insp-row2">
        <Field label={t("inspector.fromSide")}>
          <SideSelect
            testId="inspector-field-sourceSide"
            value={data.sourceSide}
            onChange={(v) => editor.updateEdge(edge.id, { sourceSide: v })}
          />
        </Field>
        <Field label={t("inspector.toSide")}>
          <SideSelect
            testId="inspector-field-targetSide"
            value={data.targetSide}
            onChange={(v) => editor.updateEdge(edge.id, { targetSide: v })}
          />
        </Field>
      </div>
      {flow && (
        <>
          <SimInput
            name="travelMs"
            field={{
              label: t("inspector.travelTime"),
              unit: "ms",
              kind: "number",
              min: 0,
              max: SIM_LIMITS.timeMs,
              step: 50,
              placeholder: String(DEFAULT_TRAVEL_MS[data.kind === "sync" ? "sync" : "async"]),
              hint: t("inspector.timeAMessageSpendsOnThisEdgeAt1x"),
            }}
            value={props.travelMs}
            onChange={(v) => editor.setEdgeProps(edge.id, { travelMs: v }, merge("travelMs"))}
          />
          <SimInput
            name="filter"
            field={{
              label: t("inspector.filter"),
              kind: "list",
              placeholder: t("inspector.allMessageTypes"),
              hint: t("inspector.onlyTheseMessageTypesTravelThisEdgeTrailingWildcard"),
            }}
            value={props.filter}
            onChange={(v) => editor.setEdgeProps(edge.id, { filter: v }, merge("filter"))}
          />
          <SimInput
            name="emits"
            field={{
              label: t("inspector.renameTo"),
              kind: "text",
              placeholder: t("inspector.unchanged"),
              hint: t("inspector.renameMessagesAsTheyLeaveAlongThisEdge"),
            }}
            value={props.emits}
            onChange={(v) => editor.setEdgeProps(edge.id, { emits: v }, merge("emits"))}
          />
        </>
      )}
      <span className="insp-label">{t("inspector.customProperties")}</span>
      <PropsEditor
        props={props}
        hidden={rule ? RULE_KEYS : EDGE_KEYS}
        onSet={(patch) => editor.setEdgeProps(edge.id, patch)}
        onSetMerged={(patch, key) => editor.setEdgeProps(edge.id, patch, merge(`prop:${key}`))}
      />
    </Disclosure>
  );
}
