import { useEffect, useRef, useState } from "react";
import { copyText } from "../../interop/ui/copyText";
import { onDeviceCases, resultsMarkdown, runOnDeviceEvals, type CaseResult } from "../evals/onDevice";
import { languageModel, modelAvailability, type ModelAvailability } from "./promptApi";
import { primedSession } from "./session";

// The Lab's on-device eval runner (?view=lab&preset=ondevice-evals): the eval cases through Chrome's
// built-in model with the AI panel's own prompt and schema. Run it by hand in a Chrome that has the
// model, then copy the table into docs/research/on-device-model.md. Never part of CI.

/** The commit this build is from (vite.config.ts `define`; "" when unknown). */
declare const __BUILD_SHA__: string;

export default function OnDeviceEvals() {
  const [availability, setAvailability] = useState<ModelAvailability | "none" | null>(null);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!languageModel()) return void setAvailability("none");
    void modelAvailability().then(setAvailability);
    return () => abort.current?.abort();
  }, []);

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setResults([]);
    try {
      const base = await primedSession((p) => setProgress(p));
      setProgress(null);
      setAvailability("available");
      await runOnDeviceEvals(
        async () => (base.clone ? base.clone() : base),
        onDeviceCases,
        (r) => setResults((all) => [...all, r]),
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted)
        setResults((all) => [...all, { id: "error", request: "", pass: false, attempts: 0, note: String(err), ms: 0 }]);
    } finally {
      setRunning(false);
    }
  };

  const passed = results.filter((r) => r.pass).length;
  /** The commit this build is from: a run on a stale deploy says so. */
  const build = __BUILD_SHA__ || "unknown";
  const meta = `Chrome ${/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? "?"}, ${new Date().toISOString().slice(0, 10)}, build ${build}.`;

  return (
    <div style={{ padding: 24, maxWidth: 900, display: "grid", gap: 12 }} data-testid="ondevice-evals">
      <h2 style={{ margin: 0 }}>On-device model evals</h2>
      <p style={{ margin: 0 }}>
        {onDeviceCases.length} cases through Chrome&apos;s built-in model, with the AI panel&apos;s prompt, schema and
        ops core. Build <strong data-testid="ondevice-evals-build">{build}</strong>. Model:{" "}
        <strong data-testid="ondevice-evals-availability">{availability ?? "checking…"}</strong>
        {progress !== null && ` · downloading ${Math.round(progress * 100)}%`}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          disabled={running || availability === "none" || availability === "unavailable" || availability === null}
          onClick={() => void run()}
          data-testid="ondevice-evals-run"
        >
          {running ? `Running… ${results.length}/${onDeviceCases.length}` : "Run evals"}
        </button>
        {running && (
          <button className="btn" onClick={() => abort.current?.abort()} data-testid="ondevice-evals-stop">
            Stop
          </button>
        )}
        <button
          className="btn"
          disabled={!results.length}
          onClick={() =>
            void copyText(resultsMarkdown(results, meta)).then((ok) => {
              setCopied(ok);
              setTimeout(() => setCopied(false), 2000);
            })
          }
          data-testid="ondevice-evals-copy"
        >
          {copied ? "Copied" : "Copy results as Markdown"}
        </button>
      </div>
      {results.length > 0 && (
        <p style={{ margin: 0 }} data-testid="ondevice-evals-rate">
          {passed}/{results.length} passed ({Math.round((passed / results.length) * 100)}%)
        </p>
      )}
      <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
        <tbody>
          {results.map((r) => (
            <tr key={r.id} data-testid={`ondevice-evals-${r.id}`} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: "4px 8px" }}>{r.pass ? "pass" : "FAIL"}</td>
              <td style={{ padding: "4px 8px" }}>{r.request}</td>
              <td style={{ padding: "4px 8px", color: "var(--text-3)" }}>
                {r.attempts} · {r.ms} ms · {r.category && <strong>{r.category}: </strong>}
                {r.note}
                {r.output && (
                  <details>
                    <summary data-testid={`ondevice-evals-${r.id}-output`}>Model output</summary>
                    <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.output}</code>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
