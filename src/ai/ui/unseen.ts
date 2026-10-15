import { t } from "../../i18n";
// Agent changes made while the AI panel was folded, counted per diagram for the rail's badge. Opening
// the panel clears the diagram's count. For this visit only; main bundle, so keep it tiny.

import { useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const unseen = {
  get: (documentId: string): number => counts.get(documentId) ?? 0,
  bump(documentId: string) {
    counts.set(documentId, unseen.get(documentId) + 1);
    emit();
  },
  copy(source: string, destination: string) {
    const count = counts.get(source);
    if (count === undefined) return;
    counts.set(destination, count);
    emit();
  },
  clear(documentId: string) {
    if (!counts.delete(documentId)) return;
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

/** Unseen agent changes in this diagram (0 without one). */
export function useUnseen(documentId: string | undefined): number {
  const get = () => (documentId ? unseen.get(documentId) : 0);
  return useSyncExternalStore(unseen.subscribe, get, get);
}

/** The rail button's name: "AI panel", or "AI panel, 2 new changes". */
export const railLabel = (count: number) => (count > 0 ? t("ai.unseen", { count }) : t("ai.aIPanel"));
