import { useSimulationSetting } from "./useSimulationSetting";
import type { EditorApi } from "../../editor/types";
import { Dropdown } from "../../components/Dropdown";
import type { QueuePriority } from "../../sim/types";
import { t } from "../../i18n";
import { Field } from "./fields";
import { Disclosure } from "./Disclosure";

export function PriorityField({ value, set }: { value?: QueuePriority; set: (value: QueuePriority) => void }) {
  return (
    <Disclosure
      id="queue-priority"
      title={t("resilience.priority")}
      summary={
        value === "critical"
          ? t("resilience.critical")
          : value === "sheddable"
            ? t("resilience.sheddable")
            : t("resilience.normal")
      }
    >
      <Field label={t("resilience.priority")} hint={t("resilience.priorityHint")}>
        <Dropdown
          value={value ?? "normal"}
          items={[
            { value: "critical", label: t("resilience.critical") },
            { value: "normal", label: t("resilience.normal") },
            { value: "sheddable", label: t("resilience.sheddable") },
          ]}
          onChange={(v) => set(v as QueuePriority)}
          testId="inspector-field-priority"
          aria-label={t("resilience.priority")}
        />
      </Field>
    </Disclosure>
  );
}

export function EdgePriorityField({ editor, edgeId }: { editor: EditorApi; edgeId: string }) {
  const setting = useSimulationSetting(editor, "edge", edgeId, "priority");
  if (!setting.editable) return null;
  return <PriorityField value={setting.value as QueuePriority | undefined} set={setting.set} />;
}
