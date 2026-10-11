import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { connection, modelLabel, PROVIDERS, providerInfo, useConnection } from "../engine/settings";
import type { ProviderId } from "../engine/types";

/**
 * "Connect a model": the user's own key for Claude, OpenAI or Gemini, kept in this browser only. Optional:
 * without it, Ask AI copies a prompt for any chatbot.
 */
export function ConnectModel({ onDone }: { onDone: (connected?: boolean) => void }) {
  const conn = useConnection();
  const id = useId();
  const [provider, setProvider] = useState<ProviderId>(conn?.provider ?? "anthropic");
  const [model, setModel] = useState(conn?.model ?? providerInfo("anthropic").models[0]);
  const [key, setKey] = useState("");
  const [failed, setFailed] = useState(false);
  const info = providerInfo(provider);
  const section = useRef<HTMLElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  // Opened from the composer's link or the header's key: bring it into view, ready for the key.
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest" });
    keyInput.current?.focus({ preventScroll: true });
  }, []);
  const keepsKey = !!conn && conn.provider === provider && !key.trim();
  const canSave = !!model.trim() && (!!key.trim() || keepsKey);

  const save = () => {
    if (!canSave) return;
    const ok = connection.set({ provider, model: model.trim(), key: key.trim() || conn!.key });
    setKey("");
    setFailed(!ok);
    if (ok) onDone(true);
  };

  return (
    <section ref={section} className="ai-connect" aria-labelledby={`${id}-title`} data-testid="ai-connect">
      <h3 id={`${id}-title`}>Connect a model</h3>
      <p className="ai-hint">
        Optional. With your own key, Ask AI changes the diagram right here. Without one, it copies a prompt for any
        chatbot.
      </p>
      {conn && (
        <p className="ai-connect-status" data-testid="ai-connected">
          <Icon name="check" size={13} /> {providerInfo(conn.provider).label}: {modelLabel(conn.model)}
        </p>
      )}
      <div className="ai-connect-grid">
        <label htmlFor={`${id}-provider`}>Provider</label>
        <select
          id={`${id}-provider`}
          className="ix-input"
          value={provider}
          onChange={(e) => {
            const next = e.target.value as ProviderId;
            setProvider(next);
            setModel(conn?.provider === next ? conn.model : providerInfo(next).models[0]);
          }}
          data-testid="ai-provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-model`}>Model</label>
        <input
          id={`${id}-model`}
          className="ix-input"
          list={`${id}-models`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          data-testid="ai-model"
        />
        <datalist id={`${id}-models`}>
          {info.models.map((m) => (
            <option key={m} value={m}>
              {modelLabel(m)}
            </option>
          ))}
        </datalist>
        <label htmlFor={`${id}-key`}>API key</label>
        <input
          id={`${id}-key`}
          ref={keyInput}
          className="ix-input"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={keepsKey ? "Saved: leave empty to keep it" : `Your ${info.vendor} API key`}
          autoComplete="off"
          spellCheck={false}
          data-testid="ai-key"
        />
      </div>
      <p className="ai-hint" data-testid="ai-key-note">
        Stored only in this browser and sent only to {info.vendor}. Never in files, exports or share links.
      </p>
      {failed && (
        <p className="ai-note is-error" role="alert">
          This browser didn't let the key be stored. It works until you reload.
        </p>
      )}
      <div className="ai-connect-actions">
        {conn && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              connection.set(null);
              setKey("");
            }}
            data-testid="ai-key-forget"
          >
            <Icon name="trash" size={13} /> Forget key
          </button>
        )}
        <span className="ai-grow" />
        <button className="btn" onClick={() => onDone()} data-testid="ai-connect-cancel">
          {conn ? "Done" : "Cancel"}
        </button>
        <button className="btn btn-primary" disabled={!canSave} onClick={save} data-testid="ai-key-save">
          Connect
        </button>
      </div>
    </section>
  );
}
