// TailGrids component manifest.
//
// Canonical list of every free component shipped by TailGrids v2 today.
// Generated from listing the registry directory on the upstream repo:
//
//   gh api repos/tailgrids/tailgrids/contents/apps/docs/src/registry/core
//
// 54 entries — the same set documented at https://tailgrids.com/docs/components.
// Most components are a single .tsx file at <slug>.tsx. A handful ship as
// directories with an index.tsx that re-exports the family — combobox/,
// date-picker/, spinner/. The fetcher handles both.
//
// To regenerate after a TailGrids release:
//   1. Run the gh api listing above
//   2. Diff against this list — add/remove rows
//   3. Update the matching extras options in agents.js and web/src/agents.js
//
// Categories are a best-effort grouping for the picker UI; they don't
// match TailGrids' marketing taxonomy 1:1 because their docs don't expose
// one. Re-categorise freely as the picker grows.

export const TAILGRIDS_COMPONENTS = [
  // Buttons & actions
  { id: "button", name: "Button", category: "Buttons" },
  { id: "button-group", name: "Button Group", category: "Buttons" },
  { id: "social-button", name: "Social Button", category: "Buttons" },
  { id: "toggle", name: "Toggle", category: "Buttons" },

  // Forms & inputs
  { id: "input", name: "Input", category: "Forms" },
  { id: "input-group", name: "Input Group", category: "Forms" },
  { id: "label", name: "Label", category: "Forms" },
  { id: "field", name: "Field", category: "Forms" },
  { id: "text-area", name: "Text Area", category: "Forms" },
  { id: "checkbox", name: "Checkbox", category: "Forms" },
  { id: "radio-input", name: "Radio Input", category: "Forms" },
  { id: "native-select", name: "Native Select", category: "Forms" },
  { id: "select", name: "Select", category: "Forms" },
  { id: "combobox", name: "Combobox", category: "Forms" },
  { id: "slider", name: "Slider", category: "Forms" },
  { id: "otp-input", name: "OTP Input", category: "Forms" },
  { id: "date-picker", name: "Date Picker", category: "Forms" },
  { id: "time-field", name: "Time Field", category: "Forms" },
  { id: "time-picker", name: "Time Picker", category: "Forms" },

  // Display & content
  { id: "card", name: "Card", category: "Display" },
  { id: "badge", name: "Badge", category: "Display" },
  { id: "avatar", name: "Avatar", category: "Display" },
  { id: "list", name: "List", category: "Display" },
  { id: "table", name: "Table", category: "Display" },
  { id: "chart", name: "Chart", category: "Display" },
  { id: "separator", name: "Separator", category: "Display" },
  { id: "aspect-ratio", name: "Aspect Ratio", category: "Display" },
  { id: "skeleton", name: "Skeleton", category: "Display" },
  { id: "spinner", name: "Spinner", category: "Display" },
  { id: "progress", name: "Progress", category: "Display" },

  // Feedback
  { id: "alert", name: "Alert", category: "Feedback" },
  { id: "alert-dialog", name: "Alert Dialog", category: "Feedback" },
  { id: "toast", name: "Toast", category: "Feedback" },
  { id: "tooltip", name: "Tooltip", category: "Feedback" },
  { id: "popover", name: "Popover", category: "Feedback" },

  // Navigation
  { id: "navigation-menu", name: "Navigation Menu", category: "Navigation" },
  { id: "menubar", name: "Menubar", category: "Navigation" },
  { id: "sidebar", name: "Sidebar", category: "Navigation" },
  { id: "breadcrumbs", name: "Breadcrumbs", category: "Navigation" },
  { id: "pagination", name: "Pagination", category: "Navigation" },
  { id: "tabs", name: "Tabs", category: "Navigation" },
  { id: "link", name: "Link", category: "Navigation" },
  { id: "command", name: "Command", category: "Navigation" },

  // Overlays
  { id: "dialog", name: "Dialog", category: "Overlays" },
  { id: "drawer", name: "Drawer", category: "Overlays" },
  { id: "sheet", name: "Sheet", category: "Overlays" },
  { id: "dropdown", name: "Dropdown", category: "Overlays" },
  { id: "context-menu", name: "Context Menu", category: "Overlays" },
  { id: "hover-card", name: "Hover Card", category: "Overlays" },

  // Disclosure & layout
  { id: "accordion", name: "Accordion", category: "Disclosure" },
  { id: "collapsible", name: "Collapsible", category: "Disclosure" },
  { id: "carousel", name: "Carousel", category: "Disclosure" },
  { id: "scroll-area", name: "Scroll Area", category: "Disclosure" },
  { id: "resizable", name: "Resizable", category: "Disclosure" },
];

export function listTailgridsComponents() {
  return TAILGRIDS_COMPONENTS.slice();
}

export function getTailgridsManifestEntry(id) {
  return TAILGRIDS_COMPONENTS.find((c) => c.id === id) ?? null;
}
