import { useSimulationSetting } from "./useSimulationSetting";
import type { EditorApi } from "../../editor/types";
import { Disclosure } from "./Disclosure";
import { Field } from "./fields";
import { PairedFields } from "./Layout";
import { SimInput } from "./SimulationFields";
import { t } from "../../i18n";
import type { QueuePolicy } from "../../sim/types";
import { Dropdown } from "../../components/Dropdown";

/** Queue policy stays in the lazy processor inspector's advanced tier. */
export function QueueFields({ queue = {}, set }: { queue?: QueuePolicy; set: (queue: QueuePolicy) => void }) {
  return (
    <Disclosure
      id="queue-details"
      title={t("resilience.queueDetails")}
      summary={t("resilience.queueSummary", {
        limit: queue.limit ?? t("threads.uncapped"),
        order: queue.order === "lifo" ? t("resilience.newestFirst") : t("resilience.oldestFirst"),
      })}
      description={t("resilience.queueHint")}
    >
      <PairedFields>
        <SimInput
          name="queue-limit"
          integer
          field={{
            label: t("resilience.queueLimit"),
            kind: "number",
            min: 1,
            max: 1000000,
            step: 1,
            placeholder: t("threads.uncapped"),
            hint: "",
          }}
          value={queue.limit}
          onChange={(v) => set({ ...queue, limit: typeof v === "number" ? v : undefined })}
        />
        <Field label={t("resilience.whenFull")}>
          <Dropdown
            value={queue.whenFull ?? "reject-new"}
            items={[
              { value: "reject-new", label: t("resilience.rejectNew") },
              { value: "drop-oldest", label: t("resilience.dropOldest") },
            ]}
            testId="inspector-field-queue-whenFull"
            aria-label={t("resilience.whenFull")}
            onChange={(v) => set({ ...queue, whenFull: v as QueuePolicy["whenFull"] })}
          />
        </Field>
        <Field label={t("resilience.serve")}>
          <Dropdown
            value={queue.order ?? "fifo"}
            items={[
              { value: "fifo", label: t("resilience.oldestFirst") },
              { value: "lifo", label: t("resilience.newestFirst") },
            ]}
            testId="inspector-field-queue-order"
            aria-label={t("resilience.serve")}
            onChange={(v) => set({ ...queue, order: v as QueuePolicy["order"] })}
          />
        </Field>
        <SimInput
          name="queue-maxWaitMs"
          integer
          field={{
            label: t("resilience.maxWaitMs"),
            kind: "number",
            min: 0,
            max: 600000,
            step: 1,
            unit: "ms",
            placeholder: t("resilience.off"),
            hint: "",
          }}
          value={queue.maxWaitMs}
          onChange={(v) => set({ ...queue, maxWaitMs: typeof v === "number" ? v : undefined })}
        />
      </PairedFields>
    </Disclosure>
  );
}

export function NodeQueueFields({ editor, nodeId }: { editor: EditorApi; nodeId: string }) {
  const setting = useSimulationSetting(editor, "node", nodeId, "queue");
  if (!setting.editable) return null;
  return (
    <>
      {setting.overridden && (
        <p className="insp-note" data-testid="queue-simulation-override">
          {t("threads.simulationOverride", {
            value: (setting.base as QueuePolicy | undefined)?.limit ?? t("threads.uncapped"),
          })}
        </p>
      )}
      <QueueFields queue={setting.value as QueuePolicy | undefined} set={setting.set} />
    </>
  );
}
