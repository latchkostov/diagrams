import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import { ContextMenu } from "./ContextMenu";
import type { MenuNode } from "../editor/actions";

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  icon?: IconName;
  className?: string;
  hint?: string;
  disabled?: boolean;
}

export interface DropdownGroup<T extends string = string> {
  label: string;
  options: readonly DropdownOption<T>[];
}

export type DropdownItem<T extends string = string> = DropdownOption<T> | DropdownGroup<T>;

export interface DropdownProps<T extends string = string> {
  value?: T;
  onChange: (value: T) => void;
  items: readonly DropdownItem<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  name?: string;
  "aria-label"?: string;
  renderTrigger?: (selected: DropdownOption<T> | undefined) => ReactNode;
}

function isDropdownGroup<T extends string = string>(item: DropdownItem<T>): item is DropdownGroup<T> {
  return "options" in item && Array.isArray(item.options);
}

function findSelectedOption<T extends string>(
  items: readonly DropdownItem<T>[],
  value: T | undefined,
): DropdownOption<T> | undefined {
  if (value === undefined) return undefined;
  for (const item of items) {
    if (isDropdownGroup(item)) {
      const match = item.options.find((opt) => opt.value === value);
      if (match) return match;
    } else if (item.value === value) {
      return item;
    }
  }
  return undefined;
}

function toMenuNodes<T extends string>(
  items: readonly DropdownItem<T>[],
  currentValue: T | undefined,
  onChange: (value: T) => void,
  onClose: () => void,
): MenuNode[] {
  const nodes: MenuNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isDropdownGroup(item)) {
      if (i > 0) nodes.push({ type: "separator" });
      nodes.push({ type: "header", label: item.label });
      for (const opt of item.options) {
        nodes.push({
          type: "item",
          id: opt.value,
          label: opt.label,
          icon: opt.icon,
          hint: opt.hint,
          className: opt.className,
          disabled: opt.disabled,
          checked: opt.value === currentValue,
          run: () => {
            onChange(opt.value);
            onClose();
          },
        });
      }
    } else {
      nodes.push({
        type: "item",
        id: item.value,
        label: item.label,
        icon: item.icon,
        hint: item.hint,
        className: item.className,
        disabled: item.disabled,
        checked: item.value === currentValue,
        run: () => {
          onChange(item.value);
          onClose();
        },
      });
    }
  }
  return nodes;
}

export function Dropdown<T extends string = string>({
  value,
  onChange,
  items,
  placeholder,
  disabled = false,
  className = "",
  testId,
  name,
  "aria-label": ariaLabel,
  renderTrigger,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const selected = useMemo(() => findSelectedOption(items, value), [items, value]);

  const openMenu = useCallback(() => {
    if (disabled || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.bottom + 4, minWidth: r.width });
    setOpen(true);
  }, [disabled]);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      openMenu();
    }
  };

  const menuNodes = useMemo(() => toMenuNodes(items, value, onChange, closeMenu), [items, value, onChange, closeMenu]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`insp-input dropdown-trigger ${className}`.trim()}
        disabled={disabled}
        name={name}
        value={value ?? ""}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={open ? closeMenu : openMenu}
        onKeyDown={handleKeyDown}
      >
        {renderTrigger ? (
          renderTrigger(selected)
        ) : (
          <>
            <span className={`dropdown-lead${selected?.className ? ` ${selected.className}` : ""}`}>
              {selected?.icon && <Icon name={selected.icon} size={14} />}
            </span>
            <span className="dropdown-label">{selected ? selected.label : (placeholder ?? "")}</span>
            <span className="dropdown-chevron">
              <Icon name="chevron-down" size={14} />
            </span>
          </>
        )}
      </button>
      {open && anchor && (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          minWidth={anchor.minWidth}
          label={ariaLabel ?? placeholder ?? "Dropdown"}
          testId={testId ? `${testId}-menu` : "dropdown-menu"}
          items={menuNodes}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
