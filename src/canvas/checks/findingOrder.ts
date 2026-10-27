import type { Finding } from "../../checks/types";

export const firstSentence = (message: string) => message.match(/^.*?(?:[.!?](?:\s|$)|[。！？؟۔।])/u)?.[0] ?? message;

/** Numbers belong to the complete list, so filtering never changes a finding's identity. */
export function findingOrder(findings: readonly Finding[]) {
  return [
    ...findings.filter((finding) => finding.severity === "warning"),
    ...findings.filter((finding) => finding.severity === "suggestion"),
  ];
}
export function selectedFinding(findings: readonly Finding[], finding: string | null, element: string | null) {
  const visible = element ? findings.filter((f) => f.elements.includes(element)) : findings;
  return visible.find((f) => f.id === finding) ?? visible[0];
}
export function findingTag(
  findings: readonly Finding[],
  selected: string | null,
  numbers: ReadonlyMap<string, number>,
) {
  const finding = findings.find((f) => f.id === selected);
  const chosen = finding ? { id: finding.id, number: numbers.get(finding.id)!, title: finding.title } : undefined;
  return { selected: chosen, count: findings.length - (chosen ? 1 : 0) };
}
