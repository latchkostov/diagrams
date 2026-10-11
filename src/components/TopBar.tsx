import { useRef } from "react";
import { useSettings } from "../harness/settings";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";
import { edgeStyles, type EdgeStyle } from "../harness/edgeStyles";
import { Icon } from "./Icon";
import type { View } from "../lib/urlState";

export interface ExampleOption {
  slug: string;
  title: string;
}

interface Props {
  view: View;
  onView: (v: View) => void;
  exampleOptions: ExampleOption[];
  example?: string;
  onExample: (slug: string) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onPresent: () => void;
}

export function TopBar(p: Props) {
  const s = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const canvas = p.view === "canvas";
  const lab = p.view === "lab";
  // The Lab is a dev harness: linked from the top bar in dev builds only. Production keeps it
  // reachable by URL (?view=lab) and shows the tab only while you're on it.
  const showLab = import.meta.env.DEV || lab;

  return (
    <header className="topbar" data-testid="topbar">
      <div className="brand" data-testid="brand">
        <Logo />
        <span>Diagrams</span>
      </div>

      <div className="segmented" role="tablist" aria-label="View">
        <button role="tab" aria-selected={p.view === "gallery"} className={p.view === "gallery" ? "is-on" : ""} onClick={() => p.onView("gallery")} data-testid="view-gallery">
          <Icon name="grid" size={14} /> Gallery
        </button>
        <button role="tab" aria-selected={canvas} className={canvas ? "is-on" : ""} onClick={() => p.onView("canvas")} data-testid="view-canvas">
          <Icon name="canvas" size={14} /> Canvas
        </button>
        {showLab && (
          <button role="tab" aria-selected={lab} className={lab ? "is-on" : ""} onClick={() => p.onView("lab")} data-testid="view-lab" title="Component lab: presets of the current code">
            <LabGlyph /> Lab
          </button>
        )}
      </div>

      {canvas && (
        <label className="select">
          <span className="sr-only">Diagram</span>
          <select value={p.example} onChange={(e) => p.onExample(e.target.value)} name="example" data-testid="example-picker">
            {p.exampleOptions.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="topbar-spacer" />

      <div className="topbar-group" aria-label="Look" data-testid="topbar-look">
        <label className="select select-quiet" title="Node renderer">
          <span className="select-prefix">Node</span>
          <select value={s.nodeVariant} onChange={(e) => s.set("nodeVariant", e.target.value as NodeVariantId)} name="node-variant" data-testid="variant-picker">
            {Object.entries(nodeVariants).map(([id, v]) => (
              <option key={id} value={id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {(canvas || lab) && (
          <label className="select select-quiet" title="Edge path style">
            <span className="select-prefix">Edge</span>
            <select value={s.edgeStyle} onChange={(e) => s.set("edgeStyle", e.target.value as EdgeStyle)} name="edge-style" data-testid="edge-style-picker">
              {edgeStyles.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="topbar-group" data-testid="topbar-actions">
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImport(f);
            e.target.value = "";
          }}
          name="import-file"
          data-testid="import-input"
        />
        <button className="btn" onClick={() => file.current?.click()} data-testid="import-button" title="Open a diagrams/v1 JSON file">
          <Icon name="upload" size={14} /> Import
        </button>
        {canvas && (
          <button className="btn" onClick={p.onExport} data-testid="export-button" title="Download this diagram as JSON">
            <Icon name="download" size={14} /> Export
          </button>
        )}
        {canvas && (
          <button className="btn btn-primary" onClick={p.onPresent} data-testid="present-toggle" title="Hide the chrome for meetings">
            <Icon name="present" size={14} /> Present
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => s.set("theme", s.theme === "dark" ? "light" : "dark")}
          aria-label={s.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={s.theme === "dark" ? "Light theme" : "Dark theme"}
          data-testid="theme-toggle"
        >
          <Icon name={s.theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

function LabGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2h4M6.75 2v4.25L3 12.75A1 1 0 0 0 3.9 14.25h8.2a1 1 0 0 0 .9-1.5L9.25 6.25V2M4.75 10h6.5" />
    </svg>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="logo">
      <rect x="1.5" y="3" width="8" height="6" rx="2" className="logo-a" />
      <rect x="14.5" y="15" width="8" height="6" rx="2" className="logo-b" />
      <path d="M9.5 6h3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 0 2.5 2.5" fill="none" className="logo-wire" />
      <circle cx="12.5" cy="6" r="1.4" className="logo-dot" />
    </svg>
  );
}
