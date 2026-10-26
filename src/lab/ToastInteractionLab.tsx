import { useEffect, useRef, useState } from "react";
import { toast } from "../interop/ui/toast";
import { t } from "../i18n";
import { InjectFrame } from "../live/InjectFrame";

/** External arrivals and moving canvas bars, independent of the pointer using the real Toaster. */
export function ToastInteractionLab() {
  const [undos, setUndos] = useState(0);
  const [raised, setRaised] = useState(false);
  const [inject, setInject] = useState(false);
  const [submissions, setSubmissions] = useState(0);
  const entry = useRef({});
  useEffect(() => toast.bindHistory({ capture: () => entry.current, current: () => entry.current }), []);
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
      <button
        data-testid="toast-lab-palette"
        onClick={() =>
          toast.info(t("command.commandPalette"), {
            action: {
              label: t("command.commandPalette"),
              run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })),
              testId: "toast-lab-open-palette",
            },
          })
        }
      >
        {t("command.commandPalette")}
      </button>
      <button data-testid="toast-lab-bar" onClick={() => setRaised((value) => !value)}>
        Move bar
      </button>
      <output data-testid="toast-lab-undos">{undos}</output>
      <button data-testid="toast-lab-inject" onClick={() => setInject(true)}>
        Inject frame
      </button>
      <button
        data-testid="toast-lab-inject-undo"
        onClick={() => toast.info("Inject feedback", { action: { label: t("routing.undo"), run() {}, undoes: true } })}
      >
        Inject feedback
      </button>
      <button
        data-testid="toast-lab-invalidate"
        onClick={() => {
          entry.current = {};
          toast.invalidateUndo();
        }}
      >
        Invalidate Undo
      </button>
      <output data-testid="toast-lab-submissions">{submissions}</output>
      {inject && (
        <InjectFrame
          request={{ nodeId: "fixture", x: 100, y: 100 }}
          title="Inject frame"
          onClose={() => setInject(false)}
          onSubmit={() => setSubmissions((n) => n + 1)}
        >
          <span>Inject form fixture</span>
        </InjectFrame>
      )}
      <div
        data-toast-avoid
        data-testid="toast-lab-avoid"
        style={{ position: "fixed", bottom: raised ? 100 : 0, left: "25%", width: "50%", height: 30 }}
      />
    </div>
  );
}
