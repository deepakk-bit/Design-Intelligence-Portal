// Agent registry for the left panel. Server-side prompts/schemas live in
// /agents.js (Node) and /prompts/*.md. The `id` here must match a server agent.

import {
  Sparkles,
  Eye,
  Accessibility,
  Ruler,
  Type,
  GitBranch,
  Layers,
  Compass,
  ClipboardCheck,
  ClipboardList,
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
        extras: [
          {
            key: "modelTier",
            label: "Quality",
            type: "select",
            default: "claude-sonnet-4-7",
            transient: true,
            options: [
              { value: "claude-sonnet-4-7", label: "Standard · Sonnet" },
              { value: "claude-opus-4-7", label: "High · Opus (deeper critique)" },
            ],
            help: "Standard handles most reviews. Use High for senior/handoff-grade critiques.",
          },
        ],
      },
    ],
  },
  {
    id: "generation",
    label: "Generation",
    agents: [
      {
        id: "states-variants",
        name: "States & Variants Generator",
        description:
          "Given a component name, lists every state and variant to design — and renders the full variant × size × state matrix as React + Tailwind code, ready to drag into Figma.",
        icon: Layers,
        accent: "#2563eb",
        inputs: ["text"],
        extras: [
          {
            key: "library",
            label: "Library style",
            type: "select",
            default: "shadcn",
            options: [
              { value: "shadcn", label: "shadcn/ui" },
              { value: "material", label: "Material" },
              { value: "radix", label: "Radix" },
              { value: "tailwind", label: "Tailwind base" },
            ],
          },
          {
            key: "primaryColor",
            label: "Primary colour",
            type: "color",
            default: "#0f172a",
            help: "Used as the Default / Primary variant fill.",
          },
          {
            key: "radius",
            label: "Border radius",
            type: "number",
            default: 6,
            min: 0,
            max: 999,
            suffix: "px",
            help: "Used for every size's `radius` token. Use 999 for fully pill.",
          },
          {
            key: "typography",
            label: "Typography",
            type: "select",
            default: "inter",
            options: [
              { value: "inter", label: "Inter" },
              { value: "system", label: "System UI" },
              { value: "roboto", label: "Roboto" },
              { value: "sf-pro", label: "SF Pro" },
              { value: "geist", label: "Geist" },
              { value: "manrope", label: "Manrope" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "discovery",
    label: "Discovery",
    agents: [
      {
        id: "reference-finder",
        name: "Reference Finder",
        description:
          "Upload a UI element or describe one — pulls similar real-product references via Refero.",
        icon: Compass,
        accent: "#0891b2",
        inputs: ["image", "text"],
        inputsRequireOneOf: ["image", "text"],
      },
    ],
  },
  {
    id: "qa",
    label: "QA",
    agents: [
      {
        id: "qa-review",
        name: "QA Review",
        description:
          "Compare design vs built screenshots and produce a concise QA review — verdict, checkable issue log, coverage by category, and prioritised recommendations.",
        icon: ClipboardCheck,
        accent: "#9333ea",
        imageSlots: [
          {
            key: "designImage",
            label: "Design",
            help: "Figma export or design-file screenshot.",
          },
          {
            key: "builtImage",
            label: "Built",
            help: "Screenshot of the implemented UI.",
          },
        ],
        extras: [
          {
            key: "modelTier",
            label: "Quality",
            type: "select",
            default: "claude-sonnet-4-7",
            transient: true,
            options: [
              { value: "claude-sonnet-4-7", label: "Standard · Sonnet" },
              { value: "claude-opus-4-7", label: "High · Opus (critical handoffs)" },
            ],
            help: "Standard for routine QA. Use High when the verdict is going to gate a release.",
          },
        ],
      },
      {
        id: "dev-handoff",
        name: "Dev Handoff Checker",
        description:
          "Reviews a set of Figma frames before they ship to engineering and surfaces what's complete vs missing — states, interactions, spacing, assets, edge cases, responsive.",
        icon: ClipboardList,
        accent: "#0d9488",
        imageSlots: [
          { key: "frame1", label: "Frame 1", help: "Required. Primary screen." },
          { key: "frame2", label: "Frame 2", help: "Optional.", optional: true },
          { key: "frame3", label: "Frame 3", help: "Optional.", optional: true },
          { key: "frame4", label: "Frame 4", help: "Optional.", optional: true },
        ],
        inputs: ["text"],
        inputsRequireAll: ["text"],
        textInputKind: "prompt",
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
