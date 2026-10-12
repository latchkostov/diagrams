import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { DiagramFile } from "../../model/types";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { publishedTools, TOOL_HELP } from "../webmcp/toolList";
import { exampleRequest } from "./exampleRequest";

// How to use AI here: the idle AI panel's answer to "where do I type?". The panel has no request box of
// its own (agents are the main path), so it says where to ask: the browser's AI assistant (with WebMCP),
// a coding agent with the Live Diagrams skill, or any chatbot through Advanced.

const base = () => import.meta.env.BASE_URL;

export function HowTo({
  mcp,
  live,
  current,
  onOpenAdvanced,
}: {
  /** The browser has WebMCP (document.modelContext). */
  mcp: boolean;
  live: boolean;
  current: DiagramFile | null;
  onOpenAdvanced: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const example = exampleRequest(current, live);

  const copyExample = async () => {
    if (!(await copyText(example))) return notify("The browser didn't allow copying. Try again.", { kind: "error" });
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ai-howto" data-testid="ai-howto">
      <h4 className="ai-howto-title">Ways to use AI here</h4>
      <ol className="ai-ways">
        {mcp && (
          <li className="ai-way" data-testid="ai-way-browser">
            <p className="ai-way-title">Your browser&apos;s AI assistant</p>
            <p className="ai-way-text">
              Ask it, e.g. “<span data-testid="ai-example-request">{example}</span>”.
              {!live && " Its changes appear here, with Undo."}
            </p>
            <button className="ai-way-action" onClick={() => void copyExample()} data-testid="ai-copy-example">
              <Icon name={copied ? "check" : "copy"} size={13} />
              {copied ? "Copied" : "Copy example request"}
            </button>
          </li>
        )}
        <li className="ai-way" data-testid="ai-way-skill">
          <p className="ai-way-title">Your coding agent</p>
          <p className="ai-way-text">
            Claude Code, Codex or the Claude apps: install the Live Diagrams skill, then ask it to diagram something. It
            replies with a share link.
          </p>
          <a
            className="ai-way-action"
            href={`${base()}skill/`}
            target="_blank"
            rel="noopener"
            data-testid="ai-skill-link"
          >
            <Icon name="link" size={13} />
            Install the skill
          </a>
        </li>
        <li className="ai-way" data-testid="ai-way-chatbot">
          <p className="ai-way-title">Any chatbot</p>
          <p className="ai-way-text">Copy a prompt from Advanced, then paste the reply.</p>
          <button className="ai-way-action" onClick={onOpenAdvanced} data-testid="ai-open-advanced">
            <Icon name="chevron-right" size={13} />
            Open Advanced
          </button>
        </li>
      </ol>
      {mcp && (
        <details className="ai-tools" data-testid="ai-tools">
          <summary data-testid="ai-tools-toggle">
            <Icon name="chevron-right" size={12} />
            What agents can do here
          </summary>
          <ul className="ai-tools-list" data-testid="ai-tools-list">
            {publishedTools(live).map((name) => (
              <li key={name} data-testid={`ai-tool-${name}`}>
                <code>{name}</code>
                <span>{TOOL_HELP[name]}</span>
              </li>
            ))}
          </ul>
          {live && <p className="ai-tools-note">Editing tools come back when you go back to editing.</p>}
        </details>
      )}
    </div>
  );
}

/**
 * Whether agents can use this page here, honestly: WebMCP only means the page publishes its tools; the
 * browser's assistant still has to support them. Without WebMCP, /llms.txt for agents that drive pages.
 */
export function AgentStatus({ available, localOnly, live }: { available: boolean; localOnly: boolean; live: boolean }) {
  const on = available && !localOnly;
  const count = publishedTools(live).length;
  return (
    <div
      className={`ai-agent-status${on ? " is-on" : ""}`}
      data-testid="ai-agent-status"
      data-available={on ? "1" : "0"}
      {...(on ? { "data-tools": count } : {})}
    >
      <span className="ai-agent-dot" aria-hidden />
      {localOnly ? (
        <p>The page&apos;s tools are off for this local-only diagram.</p>
      ) : available ? (
        <div>
          <p data-testid="ai-agent-status-text">
            This page publishes {count} tools for AI agents in this browser (WebMCP).
          </p>
          <p className="ai-agent-status-hint" data-testid="ai-agent-status-hint">
            Your browser&apos;s assistant must support WebMCP to use them. Type your request there, not here.
          </p>
        </div>
      ) : (
        <p>
          No WebMCP in this browser. Agents that drive pages can read{" "}
          <a href={`${base()}llms.txt`} target="_blank" rel="noopener" data-testid="ai-llms-link">
            llms.txt
          </a>
          .
        </p>
      )}
    </div>
  );
}
