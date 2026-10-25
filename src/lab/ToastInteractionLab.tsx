import { useState } from "react";
import { toast } from "../interop/ui/toast";
import { t } from "../i18n";

/** External arrivals and moving canvas bars, independent of the pointer using the real Toaster. */
export function ToastInteractionLab() {
  const [undos, setUndos] = useState(0);
  const [raised, setRaised] = useState(false);
  return (
    <div>
      <button
        data-testid="toast-lab-first"
        onClick={() =>
          toast.info("First notification", {
            action: { label: t("routing.undo"), run: () => setUndos((n) => n + 1), testId: "toast-lab-undo" },
          })
        }
      >
        First notification
      </button>
      <button data-testid="toast-lab-next" onClick={() => toast.info("Second notification")}>
        Second notification
      </button>
      <button data-testid="toast-lab-bar" onClick={() => setRaised((value) => !value)}>
        Move bar
      </button>
      <output data-testid="toast-lab-undos">{undos}</output>
      <div
        data-toast-avoid
        data-testid="toast-lab-avoid"
        style={{ position: "fixed", bottom: raised ? 100 : 0, left: "25%", width: "50%", height: 30 }}
      />
    </div>
  );
}
