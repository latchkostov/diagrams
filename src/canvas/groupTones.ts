import type { GroupTone } from "./types";

export const toneColor: Record<GroupTone, string> = {
  azure: "#2f80ed",
  aws: "#f08c00",
  gcp: "#1e9e5a",
  k8s: "#6c5ce7",
  onprem: "#64748b",
  neutral: "#8a94a6",
};

export const toneLabel: Record<GroupTone, string> = {
  azure: "Azure",
  aws: "AWS",
  gcp: "Google Cloud",
  k8s: "Kubernetes",
  onprem: "On-premises",
  neutral: "Neutral",
};
