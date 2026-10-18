import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownView } from "./MarkdownView";
import { handleMarkdownKeyDown } from "./markdownKeys";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  name?: string;
  ariaLabel?: string;
  testId?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Inspector Markdown field with Preview-first mode when populated and Edit mode (<textarea>)
 * when empty. Keeps the underlying <textarea> mounted in the same grid cell so click-to-edit,
 * native word/line selection, and keyboard shortcuts work seamlessly.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 9,
  maxLength,
  name,
  ariaLabel,
  testId,
  onFocus,
  onBlur,
}: MarkdownEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [explicitPreview, setExplicitPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasContent = value.trim().length > 0;
  const showPreview = !isEditing && (hasContent || explicitPreview);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (showPreview) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(380, Math.max(176, el.scrollHeight))}px`;
  }, [value, showPreview]);

  const switchToEdit = useCallback(() => {
    setIsEditing(true);
    setExplicitPreview(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const switchToPreview = useCallback(() => {
    setIsEditing(false);
    setExplicitPreview(true);
    textareaRef.current?.blur();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsEditing(false);
        el.blur();
        return;
      }

      // Tab / Shift+Tab inserts or removes 2-space indentation
      if (e.key === "Tab") {
        e.preventDefault();
        const start = el.selectionStart;
        const end = el.selectionEnd;

        if (!e.shiftKey) {
          const next = value.slice(0, start) + "  " + value.slice(end);
          onChange(next);
          requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(start + 2, start + 2);
          });
        } else {
          const lineStart = value.lastIndexOf("\n", start - 1) + 1;
          if (value.slice(lineStart, lineStart + 2) === "  ") {
            const next = value.slice(0, lineStart) + value.slice(lineStart + 2);
            onChange(next);
            const pos = Math.max(lineStart, start - 2);
            requestAnimationFrame(() => {
              el.focus();
              el.setSelectionRange(pos, pos);
            });
          }
        }
        return;
      }

      handleMarkdownKeyDown(e, el, value, onChange);
    },
    [value, onChange],
  );

  return (
    <div
      className={`md-editor ${showPreview ? "is-preview" : "is-editing"}`}
      data-testid={testId ? `${testId}-editor` : undefined}
    >
      <div className="md-editor-header">
        <div className="md-editor-tabs">
          <button
            type="button"
            className={`md-editor-tab ${showPreview ? "active" : ""}`}
            aria-pressed={showPreview}
            onMouseDown={(e) => e.preventDefault()}
            onClick={switchToPreview}
            data-testid={testId ? `${testId}-tab-preview` : undefined}
          >
            Preview
          </button>
          <button
            type="button"
            className={`md-editor-tab ${!showPreview ? "active" : ""}`}
            aria-pressed={!showPreview}
            onMouseDown={(e) => e.preventDefault()}
            onClick={switchToEdit}
            data-testid={testId ? `${testId}-tab-edit` : undefined}
          >
            Edit
          </button>
        </div>
        <span className="md-editor-shortcut-hint">
          {!showPreview ? "Ctrl+B bold · Ctrl+I italic · Ctrl+K link" : "Click to edit"}
        </span>
      </div>

      <div className="md-editor-body">
        <textarea
          ref={textareaRef}
          className={`insp-input md-editor-textarea${showPreview ? " is-preview-hidden" : ""}`}
          rows={rows}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          name={name}
          aria-label={ariaLabel}
          onFocus={() => {
            setIsEditing(true);
            setExplicitPreview(false);
            onFocus?.();
          }}
          onBlur={() => {
            setIsEditing(false);
            onBlur?.();
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          data-markdown-input=""
          data-testid={testId}
        />
        {showPreview && (
          <div className="md-editor-rendered" data-testid={testId ? `${testId}-rendered` : undefined}>
            {hasContent ? (
              <MarkdownView text={value} />
            ) : (
              <span className="md-editor-placeholder">{placeholder || "Click to edit…"}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
