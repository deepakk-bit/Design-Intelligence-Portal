// Agent registry for the left panel. Server-side prompts/schemas live in
// /agents.js (Node) and /prompts/*.md. The `id` here must match a server agent.

import {
  Sparkles,
  Eye,
  Accessibility,
  Ruler,
  Type,
  GitBranch,
} from "lucide-react";

export const AGENT_CATEGORIES = [
  {
    id: "analysis",
    label: "Analysis",
    agents: [
      {
        id: "interaction",
        name: "Component Interaction Analyst",
        description:
          "Analyzes a screenshot for interaction quality, edge cases, and recommended fixes.",
        icon: Sparkles,
        accent: "#7c3aed",
        inputs: ["image"],
      },
    ],
  },
  {
    id: "coming-soon",
    label: "Coming soon",
    agents: [
      {
        id: "visual-critic",
        name: "Visual Critic",
        description: "Hierarchy, spacing, and typographic balance review.",
        icon: Eye,
        accent: "#0ea5e9",
        inputs: ["image"],
        disabled: true,
      },
      {
        id: "a11y",
        name: "Accessibility Reviewer",
        description: "WCAG 2.2 AA findings against the screenshot.",
        icon: Accessibility,
        accent: "#10b981",
        inputs: ["image"],
        disabled: true,
      },
      {
        id: "layout",
        name: "Layout Critic",
        description: "Grid, alignment, and responsive breakpoint analysis.",
        icon: Ruler,
        accent: "#f59e0b",
        inputs: ["image"],
        disabled: true,
      },
      {
        id: "microcopy",
        name: "Microcopy Writer",
        description: "Improves labels, errors, and CTAs.",
        icon: Type,
        accent: "#ef4444",
        inputs: ["image", "text"],
        disabled: true,
      },
      {
        id: "flow",
        name: "Flow Mapper",
        description: "Maps user flow and identifies dead-ends.",
        icon: GitBranch,
        accent: "#8b5cf6",
        inputs: ["image"],
        disabled: true,
      },
    ],
  },
];

const ALL_AGENTS = AGENT_CATEGORIES.flatMap((c) => c.agents);

export function getAgentDef(id) {
  return ALL_AGENTS.find((a) => a.id === id) ?? null;
}
