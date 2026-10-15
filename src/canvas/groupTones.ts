import type { GroupTone } from "./types";
import { isHexColor } from "../model/colors";

export const GROUP_TONES: GroupTone[] = ["azure", "aws", "gcp", "k8s", "onprem", "neutral"];

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

export function resolveGroupTone(tone?: string): string {
  if (!tone) return toneColor.neutral;
  if (tone in toneColor) return toneColor[tone as GroupTone];
  if (isHexColor(tone)) return tone;
  return toneColor.neutral;
}

export function isPresetGroupTone(tone?: string): tone is GroupTone {
  return typeof tone === "string" && tone in toneColor;
}
