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
  Component,
} from "lucide-react";

// TailGrids picker options — mirror of lib/tailgrids-manifest.js. The
// frontend bundle can't import server-only modules, so this list is
// duplicated and kept in sync manually. Order is significant: the
// dropdown shows entries in this order, so we group by category.
const TAILGRIDS_OPTIONS = [
  // Buttons & actions
  { value: "button", label: "Buttons — Button" },
  { value: "button-group", label: "Buttons — Button Group" },
  { value: "social-button", label: "Buttons — Social Button" },
  { value: "toggle", label: "Buttons — Toggle" },
  // Forms & inputs
  { value: "input", label: "Forms — Input" },
  { value: "input-group", label: "Forms — Input Group" },
  { value: "label", label: "Forms — Label" },
  { value: "field", label: "Forms — Field" },
  { value: "text-area", label: "Forms — Text Area" },
  { value: "checkbox", label: "Forms — Checkbox" },
  { value: "radio-input", label: "Forms — Radio Input" },
  { value: "native-select", label: "Forms — Native Select" },
  { value: "select", label: "Forms — Select" },
  { value: "combobox", label: "Forms — Combobox" },
  { value: "slider", label: "Forms — Slider" },
  { value: "otp-input", label: "Forms — OTP Input" },
  { value: "date-picker", label: "Forms — Date Picker" },
  { value: "time-field", label: "Forms — Time Field" },
  { value: "time-picker", label: "Forms — Time Picker" },
  // Display & content
  { value: "card", label: "Display — Card" },
  { value: "badge", label: "Display — Badge" },
  { value: "avatar", label: "Display — Avatar" },
  { value: "list", label: "Display — List" },
  { value: "table", label: "Display — Table" },
  { value: "chart", label: "Display — Chart" },
  { value: "separator", label: "Display — Separator" },
  { value: "aspect-ratio", label: "Display — Aspect Ratio" },
  { value: "skeleton", label: "Display — Skeleton" },
  { value: "spinner", label: "Display — Spinner" },
  { value: "progress", label: "Display — Progress" },
  // Feedback
  { value: "alert", label: "Feedback — Alert" },
  { value: "alert-dialog", label: "Feedback — Alert Dialog" },
  { value: "toast", label: "Feedback — Toast" },
  { value: "tooltip", label: "Feedback — Tooltip" },
  { value: "popover", label: "Feedback — Popover" },
  // Navigation
  { value: "navigation-menu", label: "Navigation — Navigation Menu" },
  { value: "menubar", label: "Navigation — Menubar" },
  { value: "sidebar", label: "Navigation — Sidebar" },
  { value: "breadcrumbs", label: "Navigation — Breadcrumbs" },
  { value: "pagination", label: "Navigation — Pagination" },
  { value: "tabs", label: "Navigation — Tabs" },
  { value: "link", label: "Navigation — Link" },
  { value: "command", label: "Navigation — Command" },
  // Overlays
  { value: "dialog", label: "Overlays — Dialog" },
  { value: "drawer", label: "Overlays — Drawer" },
  { value: "sheet", label: "Overlays — Sheet" },
  { value: "dropdown", label: "Overlays — Dropdown" },
  { value: "context-menu", label: "Overlays — Context Menu" },
  { value: "hover-card", label: "Overlays — Hover Card" },
  // Disclosure & layout
  { value: "accordion", label: "Disclosure — Accordion" },
  { value: "collapsible", label: "Disclosure — Collapsible" },
  { value: "carousel", label: "Disclosure — Carousel" },
  { value: "scroll-area", label: "Disclosure — Scroll Area" },
  { value: "resizable", label: "Disclosure — Resizable" },
];

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
            default: "opus",
            transient: true,
            options: [
              { value: "opus", label: "High · Opus (deepest critique)" },
              { value: "sonnet", label: "Standard · Sonnet (faster / cheaper)" },
            ],
            help: "High is the default. Drop to Standard when you want a quick read or batch many reviews.",
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
    id: "components",
    label: "Components",
    agents: [
      {
        id: "tailgrids",
        name: "Component Generator (TailGrids)",
        description:
          "Pick a TailGrids component — fetched live from the upstream repo. Phase 1 returns the raw .tsx source for direct paste into a TailGrids-configured codebase.",
        icon: Component,
        accent: "#3056D3",
        // No image, no text. The component picker (a select extra) is the
        // only input. Setting inputs: [] tells AgentNode not to render the
        // image dropzone or component-name field.
        inputs: [],
        extras: [
          {
            key: "componentId",
            label: "Component",
            type: "select",
            default: "button",
            // Mirror of lib/tailgrids-manifest.js — kept in sync manually
            // because the frontend bundle and the Node server can't
            // import the same module. To regenerate: take
            // TAILGRIDS_COMPONENTS from that file and flatten as
            // `${category} — ${name}`.
            options: TAILGRIDS_OPTIONS,
            help: "Live-fetched from the TailGrids GitHub repo. Plugin-ready JSX preview lands in Phase 2.",
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
            default: "opus",
            transient: true,
            options: [
              { value: "opus", label: "High · Opus (default — critical handoffs)" },
              { value: "sonnet", label: "Standard · Sonnet (routine sweeps)" },
            ],
            help: "High is the default. Drop to Standard when you want a quick scan.",
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
