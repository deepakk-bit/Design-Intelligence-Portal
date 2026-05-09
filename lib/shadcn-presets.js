// Canonical shadcn/ui matrix presets.
//
// These tokens mirror shadcn's source-of-truth components — pulled from
// the registry at https://ui.shadcn.com/r/styles/default and resolved
// against the default zinc theme (CSS vars in globals.css). Hardcoded
// because:
//   1. shadcn's default theme rarely changes — values stay stable.
//   2. Live fetching adds 1–3s latency on every run for marginal gain.
//   3. cva-block parsing is brittle to upstream refactors; an explicit
//      token table is auditable and version-controlled.
//
// To add support for a new shadcn component, add an entry here keyed by
// the slugified component name. The handler looks it up after the model
// returns and replaces the model's invented matrix with this one when a
// match is found.

const STATES = [
  { id: "default", label: "Default", modifier: "rest" },
  { id: "hover", label: "Hover", modifier: "hover" },
  { id: "focus", label: "Focus", modifier: "focus" },
  { id: "loading", label: "Loading", modifier: "loading" },
  { id: "disabled", label: "Disabled", modifier: "disabled" },
  { id: "pressed", label: "Pressed", modifier: "pressed" },
];

// shadcn default zinc theme — CSS vars resolved to hex.
// Source: https://ui.shadcn.com/themes (default new-york / zinc).
const T = {
  bg: "#ffffff",
  fg: "#0f172a",
  primary: "#0f172a",
  primaryFg: "#fafafa",
  destructive: "#dc2626",
  destructiveFg: "#fafafa",
  secondary: "#f1f5f9",
  secondaryFg: "#0f172a",
  accent: "#f1f5f9",
  accentFg: "#0f172a",
  muted: "#f1f5f9",
  mutedFg: "#64748b",
  border: "#e2e8f0",
  ring: "#0f172a",
};

// Helper to derive hover/pressed shifts in the same idiom shadcn uses
// (90% / 80% opacity over the base — we approximate with a 8/16% darken
// since the renderer already supports that fallback).
function variant(id, label, tokens) {
  return { id, label, tokens };
}

function size(id, label, tokens) {
  return { id, label, tokens };
}

const BUTTON = {
  archetype: "button",
  label: "Button",
  glyph: "circle",
  rowGroups: [
    variant("default", "Default", {
      bg: T.primary,
      bgHover: "#1e293b", // primary @ ~90%
      bgPressed: "#020617",
      border: null,
      text: T.primaryFg,
    }),
    variant("destructive", "Destructive", {
      bg: T.destructive,
      bgHover: "#b91c1c",
      bgPressed: "#991b1b",
      border: null,
      text: T.destructiveFg,
    }),
    variant("outline", "Outline", {
      bg: T.bg,
      bgHover: T.accent,
      bgPressed: T.border,
      border: T.border,
      text: T.fg,
    }),
    variant("secondary", "Secondary", {
      bg: T.secondary,
      bgHover: "#e2e8f0", // secondary @ ~80%
      bgPressed: "#cbd5e1",
      border: null,
      text: T.secondaryFg,
    }),
    variant("ghost", "Ghost", {
      bg: null,
      bgHover: T.accent,
      bgPressed: T.border,
      border: null,
      text: T.fg,
    }),
    variant("link", "Link", {
      bg: null,
      bgHover: null,
      bgPressed: null,
      border: null,
      text: T.primary,
      underline: false, // shadcn's link underlines on hover only
    }),
  ],
  rowSubItems: [
    // shadcn h-10 / h-9 / h-11 / size-10 — Tailwind 1 unit = 4px.
    size("default", "default", {
      height: 40,
      paddingX: 16,
      fontSize: 14,
      fontWeight: 500,
      radius: 6,
      iconOnly: false,
    }),
    size("sm", "sm", {
      height: 36,
      paddingX: 12,
      fontSize: 14,
      fontWeight: 500,
      radius: 6,
      iconOnly: false,
    }),
    size("lg", "lg", {
      height: 44,
      paddingX: 32,
      fontSize: 14,
      fontWeight: 500,
      radius: 6,
      iconOnly: false,
    }),
    size("icon", "icon", {
      height: 40,
      paddingX: 0,
      fontSize: 14,
      fontWeight: 500,
      radius: 6,
      iconOnly: true,
      iconSize: 16,
    }),
  ],
  columns: STATES,
  // Skip combinations that don't make sense in shadcn's component:
  //   - Link variant has no icon-only size in the canonical Button.
  //   - icon × loading would need a spinner glyph, not in the default.
  skipCells: [
    ...STATES.map((s) => ({ rowGroup: "link", rowSub: "icon", column: s.id })),
    ...["default", "destructive", "outline", "secondary", "ghost"].map((g) => ({
      rowGroup: g,
      rowSub: "icon",
      column: "loading",
    })),
  ],
};

const INPUT = {
  archetype: "input",
  label: "Email",
  glyph: "circle",
  rowGroups: [
    variant("default", "Default", {
      bg: T.bg,
      bgHover: T.bg,
      bgPressed: T.bg,
      border: T.border,
      text: T.fg,
      placeholder: T.mutedFg,
    }),
    variant("error", "Error", {
      bg: T.bg,
      bgHover: T.bg,
      bgPressed: T.bg,
      border: T.destructive,
      text: T.fg,
      placeholder: T.mutedFg,
    }),
  ],
  rowSubItems: [
    size("default", "default", {
      height: 40,
      paddingX: 12,
      fontSize: 14,
      fontWeight: 400,
      radius: 6,
      iconOnly: false,
    }),
  ],
  columns: STATES.filter((s) => s.id !== "loading"),
  skipCells: [],
};

const BADGE = {
  archetype: "badge",
  label: "Badge",
  glyph: "circle",
  rowGroups: [
    variant("default", "Default", {
      bg: T.primary,
      bgHover: "#1e293b",
      bgPressed: "#020617",
      border: null,
      text: T.primaryFg,
    }),
    variant("secondary", "Secondary", {
      bg: T.secondary,
      bgHover: "#e2e8f0",
      bgPressed: "#cbd5e1",
      border: null,
      text: T.secondaryFg,
    }),
    variant("destructive", "Destructive", {
      bg: T.destructive,
      bgHover: "#b91c1c",
      bgPressed: "#991b1b",
      border: null,
      text: T.destructiveFg,
    }),
    variant("outline", "Outline", {
      bg: T.bg,
      bgHover: T.accent,
      bgPressed: T.border,
      border: T.border,
      text: T.fg,
    }),
  ],
  rowSubItems: [
    size("default", "default", {
      height: 22,
      paddingX: 10,
      fontSize: 12,
      fontWeight: 600,
      radius: 999, // shadcn badge is fully rounded (rounded-full)
      iconOnly: false,
    }),
  ],
  columns: STATES.filter((s) => s.id !== "loading" && s.id !== "pressed"),
  skipCells: [],
};

const CARD = {
  archetype: "card",
  label: "Card",
  glyph: "circle",
  rowGroups: [
    variant("default", "Default", {
      bg: T.bg,
      bgHover: T.bg,
      bgPressed: T.bg,
      border: T.border,
      text: T.fg,
    }),
  ],
  rowSubItems: [
    size("default", "default", {
      height: 80,
      paddingX: 24,
      fontSize: 14,
      fontWeight: 500,
      radius: 12, // shadcn card uses rounded-xl (12px)
      iconOnly: false,
    }),
  ],
  // Cards don't really hover/press in shadcn's defaults — keep it simple.
  columns: [{ id: "default", label: "Default", modifier: "rest" }],
  skipCells: [],
};

const CHECKBOX = {
  archetype: "checkbox",
  label: "",
  glyph: "check",
  rowGroups: [
    variant("default", "Default", {
      bg: T.bg,
      bgHover: T.bg,
      bgPressed: T.bg,
      border: T.primary,
      text: T.primaryFg,
    }),
    variant("checked", "Checked", {
      bg: T.primary,
      bgHover: "#1e293b",
      bgPressed: "#020617",
      border: T.primary,
      text: T.primaryFg,
    }),
  ],
  rowSubItems: [
    size("default", "default", {
      height: 16,
      paddingX: 0,
      fontSize: 12,
      fontWeight: 400,
      radius: 4,
      iconOnly: true,
      iconSize: 12,
    }),
  ],
  columns: STATES.filter((s) => s.id !== "loading" && s.id !== "pressed"),
  skipCells: [],
};

const SWITCH = {
  archetype: "toggle",
  label: "",
  glyph: "circle",
  rowGroups: [
    variant("off", "Off", {
      bg: T.secondary,
      bgHover: "#e2e8f0",
      bgPressed: "#cbd5e1",
      border: null,
      text: T.secondaryFg,
    }),
    variant("on", "On", {
      bg: T.primary,
      bgHover: "#1e293b",
      bgPressed: "#020617",
      border: null,
      text: T.primaryFg,
    }),
  ],
  rowSubItems: [
    size("default", "default", {
      height: 24,
      paddingX: 0,
      fontSize: 12,
      fontWeight: 400,
      radius: 999,
      iconOnly: true,
      iconSize: 18,
    }),
  ],
  columns: STATES.filter((s) => s.id !== "loading" && s.id !== "pressed"),
  skipCells: [],
};

const AVATAR = {
  archetype: "avatar",
  label: "DK",
  glyph: "user",
  rowGroups: [
    variant("default", "Default", {
      bg: T.muted,
      bgHover: T.muted,
      bgPressed: T.muted,
      border: null,
      text: T.mutedFg,
    }),
  ],
  rowSubItems: [
    size("default", "default", {
      height: 40,
      paddingX: 0,
      fontSize: 14,
      fontWeight: 500,
      radius: 999,
      iconOnly: true,
      iconSize: 18,
    }),
  ],
  columns: [{ id: "default", label: "Default", modifier: "rest" }],
  skipCells: [],
};

// Slug → preset. The handler normalises the user's component name
// (lowercase, alphanumeric only) and looks it up here. Common synonyms
// share a preset (e.g. "switch" / "toggle").
const PRESETS = {
  button: BUTTON,
  input: INPUT,
  textfield: INPUT,
  textinput: INPUT,
  badge: BADGE,
  chip: BADGE,
  card: CARD,
  checkbox: CHECKBOX,
  switch: SWITCH,
  toggle: SWITCH,
  avatar: AVATAR,
};

function normalise(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, ""); // strip trailing 's' so "buttons"→"button"
}

export function getShadcnPreset(componentName) {
  const slug = normalise(componentName);
  if (!slug) return null;
  return PRESETS[slug] || null;
}

// Exposed for future live-fetcher integration:
//   const live = await fetchFromShadcnRegistry(slug);
//   return live ?? PRESETS[slug] ?? null;
// Not wired up yet — see top-of-file comment for why.
export const SHADCN_THEME = T;
