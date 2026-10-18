import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";

const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (/^(true|false|null|-?\d+(\.\d+)?|\[.*\]|\{.*\})$/s.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function PropValue({
  name,
  value,
  onChange,
}: {
  name: string;
  value: unknown;
  onChange: (raw: string) => void;
}) {
  const external = showValue(value);
  const [draft, setDraft] = useState(external);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(external);
  }, [external]);
  return (
    <input
      className="insp-input mono"
      value={draft}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setDraft(external);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      aria-label={t("inspector.propertyValue", { name })}
      name={`prop-${name}`}
      data-testid={`inspector-prop-${name}`}
    />
  );
}

/** Free-form key / value props (anything that isn't a known field). */
export function PropsEditor({
  props,
  hidden,
  onSet,
  onSetMerged,
}: {
  props: Record<string, unknown>;
  hidden: Set<string>;
  onSet: (patch: Record<string, unknown>) => void;
  onSetMerged: (patch: Record<string, unknown>, key: string) => void;
}) {
  const entries = Object.entries(props).filter(([k]) => !hidden.has(k));
  const [newKey, setNewKey] = useState("");
  const add = () => {
    const k = newKey.trim();
    if (!k || k in props) return;
    onSet({ [k]: "" });
    setNewKey("");
  };
  return (
    <div className="insp-props" data-testid="inspector-props">
      {entries.map(([k, v]) => (
        <div key={k} className="insp-prop">
          <span className="insp-prop-key mono" title={k}>
            {k}
          </span>
          <PropValue name={k} value={v} onChange={(raw) => onSetMerged({ [k]: parseValue(raw) }, k)} />
          <button
            className="icon-btn insp-mini"
            onClick={() => onSet({ [k]: undefined })}
            title={t("inspector.removeProperty", { name: k })}
            aria-label={t("inspector.removeProperty", { name: k })}
            data-testid={`inspector-prop-remove-${k}`}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <div className="insp-prop insp-prop-new">
        <input
          className="insp-input mono"
          value={newKey}
          placeholder={t("inspector.addProperty")}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label={t("inspector.newPropertyName")}
          name="new-prop"
          data-testid="inspector-prop-new"
        />
        <button
          className="icon-btn insp-mini"
          onClick={add}
          disabled={!newKey.trim()}
          title={t("inspector.addProperty2")}
          aria-label={t("inspector.addProperty2")}
          data-testid="inspector-prop-add"
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
    </div>
  );
}
