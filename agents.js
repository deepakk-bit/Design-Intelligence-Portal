import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readPrompt = (file) =>
  readFileSync(join(__dirname, "prompts", file), "utf8");

const interactionAnalystSchema = {
  type: "object",
  additionalProperties: false,
  required: ["usabilityScore", "summary", "strengths", "findings", "suggestions", "nextSteps"],
  properties: {
    usabilityScore: {
      type: "integer",
      description: "Honest 0–100 score. Anchor: ≤40 critical blockers, ~55 several major issues, ~85 polished with minor gaps, ≥95 exceptional.",
    },
    summary: {
      type: "string",
      description:
        "One paragraph (3–5 sentences) senior-reviewer verdict: overall take, most consequential issue, lift to fix.",
    },
    strengths: {
      type: "array",
      description: "2–4 specific things the component does well.",
      items: { type: "string" },
    },
    findings: {
      type: "array",
      description: "Ordered by severity, critical first. Cap around 8.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "severity",
          "category",
          "element",
          "observation",
          "why",
          "recommendation",
          "heuristic",
        ],
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "nit"],
          },
          category: {
            type: "string",
            enum: [
              "state-coverage",
              "affordance",
              "feedback",
              "focus-keyboard",
              "a11y-semantics",
              "hierarchy",
              "edge-cases",
              "consistency",
            ],
          },
          element: {
            type: "string",
            description:
              "The specific UI element by visible label or location, e.g. \"primary 'Run' button, bottom-right of composer\".",
          },
          observation: { type: "string", description: "What you see (or can't see) in the screenshot." },
          why: {
            type: "string",
            description: "User-impact: who is affected and how this degrades the experience.",
          },
          recommendation: {
            type: "string",
            description:
              "Concrete, implementable change. Name the property/value/behavior, not just the goal.",
          },
          heuristic: {
            type: "string",
            description:
              "Anchor citation: Nielsen #N, WCAG SC X.Y.Z, Fitts/Hick, HIG/Material, etc.",
          },
        },
      },
    },
    nextSteps: {
      type: "array",
      description: "3–5 prioritized, concrete actions in execution order.",
      items: { type: "string" },
    },
    suggestions: {
      type: "array",
      description:
        "0–4 visual UI snippets demonstrating proposed improvements. Each snippet is self-contained renderable HTML with an inline <style> block (no scripts, no external resources, only inline SVG). Snippets render in a 480x260 sandboxed preview frame.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "target", "rationale", "snippetHtml"],
        properties: {
          title: {
            type: "string",
            description: "Short imperative title, e.g. 'Add visible focus ring to primary CTA'.",
          },
          target: {
            type: "string",
            description: "The element being demonstrated, e.g. 'Primary Run button, composer footer'.",
          },
          rationale: {
            type: "string",
            description: "1–2 sentences explaining what the snippet shows and why it improves the experience.",
          },
          snippetHtml: {
            type: "string",
            description:
              "Self-contained HTML with inline <style>. No <script>, no <link>, no external fonts/images. Inline SVG only. Render the proposed end state of the element, sized to fit a 480x260 preview.",
          },
        },
      },
    },
  },
};

// Matrix-style States & Variants schema. The model picks an `archetype`
// and emits design tokens (variant fills, size paddings, state modifiers)
// instead of pixel-level SVGs. The frontend composes one big SVG matrix
// (variants × sizes × states) deterministically from those tokens, so the
// output is consistent, cheap to generate, and Figma-importable.
const variantTokens = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    bg: {
      type: ["string", "null"],
      description:
        "Fill colour (hex like #16a34a). Use null for transparent — typical for Ghost / Link variants.",
    },
    bgHover: {
      type: ["string", "null"],
      description:
        "Optional override for the Hover column. Omit/null lets the renderer derive it by darkening `bg` ~8%.",
    },
    bgPressed: {
      type: ["string", "null"],
      description:
        "Optional override for the Pressed column. Omit/null lets the renderer derive it by darkening `bg` ~16%.",
    },
    border: {
      type: ["string", "null"],
      description: "Border colour (hex), or null for no border.",
    },
    text: {
      type: "string",
      description: "Text and icon colour (hex).",
    },
    placeholder: {
      type: ["string", "null"],
      description:
        "Lighter text colour for input placeholder content. Only meaningful for input-style archetypes.",
    },
    underline: {
      type: "boolean",
      description: "True for Link variants where the label is underlined.",
    },
  },
};

const sizeTokens = {
  type: "object",
  additionalProperties: false,
  required: ["height", "paddingX", "fontSize", "radius"],
  properties: {
    height: { type: "integer", description: "Cell content height in px (e.g. 28, 32, 36, 44)." },
    paddingX: { type: "integer", description: "Horizontal padding inside the cell." },
    fontSize: { type: "integer", description: "Label font-size in px." },
    fontWeight: {
      type: "integer",
      enum: [400, 500, 600, 700],
    },
    radius: { type: "integer" },
    iconOnly: {
      type: "boolean",
      description: "True for square icon-only sizes — renders `glyph` instead of the label.",
    },
    iconSize: { type: "integer" },
  },
};

const statesVariantsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "componentName",
    "library",
    "summary",
    "matrix",
    "sections",
    "priorityOrder",
    "recommendations",
  ],
  properties: {
    componentName: {
      type: "string",
      description: "Echo the canonical component name you're generating the matrix for.",
    },
    library: {
      type: "string",
      enum: ["shadcn", "material", "radix", "tailwind"],
    },
    summary: {
      type: "string",
      description:
        "1–2 sentence overview of what this component is and the most critical state-coverage concern for it.",
    },
    matrix: {
      type: "object",
      additionalProperties: false,
      required: ["archetype", "label", "rowGroups", "rowSubItems", "columns"],
      properties: {
        archetype: {
          type: "string",
          enum: [
            "button",
            "iconButton",
            "input",
            "badge",
            "chip",
            "checkbox",
            "toggle",
            "avatar",
            "card",
            "link",
          ],
          description:
            "Drives how each cell is drawn. Use `button` for rectangular clickable components.",
        },
        label: {
          type: "string",
          description: "Default text shown inside cells, e.g. 'Button', 'Sign in', 'Search'.",
        },
        glyph: {
          type: "string",
          enum: [
            "circle",
            "plus",
            "search",
            "check",
            "arrow",
            "settings",
            "user",
            "chevronDown",
          ],
          description: "Icon used in iconOnly size cells. Required if any size has iconOnly:true.",
        },
        rowGroups: {
          type: "array",
          description:
            "Outer Y axis — typically variants. 2–8 entries. Each entry's `tokens` define the rest-state look.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "tokens"],
            properties: {
              id: { type: "string", description: "Stable id, e.g. 'default', 'secondary'." },
              label: { type: "string" },
              tokens: variantTokens,
            },
          },
        },
        rowSubItems: {
          type: "array",
          description:
            "Inner Y axis — typically sizes. 1–6 entries. If the component has no meaningful size axis, use a single entry with id 'default'.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "tokens"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              tokens: sizeTokens,
            },
          },
        },
        columns: {
          type: "array",
          description: "X axis — typically states. 2–8 entries.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "modifier"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              modifier: {
                type: "string",
                enum: [
                  "rest",
                  "hover",
                  "pressed",
                  "focus",
                  "loading",
                  "disabled",
                ],
              },
            },
          },
        },
        skipCells: {
          type: "array",
          description:
            "Sparse list of cells to leave blank because the combo is not meaningful (e.g. Ghost × icon × Loading). Reference combos by id.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rowGroup", "rowSub", "column"],
            properties: {
              rowGroup: { type: "string" },
              rowSub: { type: "string" },
              column: { type: "string" },
            },
          },
        },
      },
    },
    sections: {
      type: "array",
      description:
        "All seven sections, in this exact order: functional, validation, content, interaction, responsive, contextual, edgeCase.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "states"],
        properties: {
          id: {
            type: "string",
            enum: [
              "functional",
              "validation",
              "content",
              "interaction",
              "responsive",
              "contextual",
              "edgeCase",
            ],
          },
          title: { type: "string" },
          states: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "note"],
              properties: {
                name: { type: "string" },
                note: { type: "string" },
              },
            },
          },
        },
      },
    },
    priorityOrder: {
      type: "array",
      description:
        "Names from most to least critical to design first. 6–12 entries.",
      items: { type: "string" },
    },
    recommendations: {
      type: "array",
      description: "0–6 high-leverage best practices specific to this component.",
      items: { type: "string" },
    },
  },
};

const qaReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "componentName",
    "summary",
    "issues",
    "checkCoverage",
    "recommendations",
  ],
  properties: {
    componentName: {
      type: "string",
      description:
        "Short label for what was QA'd, inferred from the screenshots or context.",
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: [
        "totalIssues",
        "highSeverity",
        "mediumSeverity",
        "lowSeverity",
        "verdict",
      ],
      properties: {
        totalIssues: { type: "integer" },
        highSeverity: { type: "integer" },
        mediumSeverity: { type: "integer" },
        lowSeverity: { type: "integer" },
        verdict: {
          type: "object",
          additionalProperties: false,
          required: ["status", "reason"],
          properties: {
            status: {
              type: "string",
              enum: ["ready", "conditional", "blocked"],
            },
            reason: {
              type: "string",
              description:
                "1–2 sentences stating which issues drive the verdict, citing them by title.",
            },
          },
        },
      },
    },
    issues: {
      type: "array",
      description:
        "Flat list of findings, sorted high → medium → low. Each row is rendered as a checkbox in the UI; keep it concise — no long descriptions.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "severity",
          "category",
          "location",
          "property",
          "designed",
          "built",
          "fix",
          "point",
        ],
        properties: {
          title: {
            type: "string",
            description:
              "Short scannable label, 3–7 words. e.g. 'CTA padding too tight'.",
          },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          category: {
            type: "string",
            enum: [
              "spacing",
              "color",
              "typography",
              "states",
              "components",
              "responsive",
              "accessibility",
            ],
          },
          location: {
            type: "string",
            description:
              "Short element + where, e.g. 'Primary CTA, header right'.",
          },
          property: {
            type: "string",
            description:
              "The precise property that differs, e.g. 'padding-x', 'background-color', 'font-weight', 'hover state', 'variant', 'label-text'.",
          },
          designed: {
            type: "string",
            description:
              "Concrete designed value. e.g. '16px', '600 (semibold)', '#0F172A', 'present'. If exact value is unreadable, give a clear relative value like '~16px'.",
          },
          built: {
            type: "string",
            description:
              "Concrete built value, parallel format to `designed`. e.g. '8px', 'missing', 'centered'.",
          },
          fix: {
            type: "string",
            description:
              "One-sentence actionable change a developer can apply.",
          },
          point: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            description:
              "Normalised pin coordinate on the BUILT image (top-left = 0,0; bottom-right = 1,1). The frontend draws a numbered pin here so the designer can see where each issue lives.",
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
    checkCoverage: {
      type: "object",
      description:
        "Counts of issues per category. Must include all seven keys, even with 0.",
      additionalProperties: false,
      required: [
        "spacing",
        "color",
        "typography",
        "states",
        "components",
        "responsive",
        "accessibility",
      ],
      properties: {
        spacing: { type: "integer" },
        color: { type: "integer" },
        typography: { type: "integer" },
        states: { type: "integer" },
        components: { type: "integer" },
        responsive: { type: "integer" },
        accessibility: { type: "integer" },
      },
    },
    recommendations: {
      type: "object",
      additionalProperties: false,
      required: ["doNow", "thisSprint", "backlog"],
      properties: {
        doNow: {
          type: "array",
          description: "High-severity action items, phrased as imperatives.",
          items: { type: "string" },
        },
        thisSprint: {
          type: "array",
          description: "Medium-severity action items.",
          items: { type: "string" },
        },
        backlog: {
          type: "array",
          description: "Low-severity action items.",
          items: { type: "string" },
        },
      },
    },
  },
};

export const AGENTS = {
  interaction: {
    id: "interaction",
    name: "Component Interaction Analyst",
    inputs: ["image"],
    // Sonnet by default — Opus on demand for deep critique. The toggle is
    // declared as a transient extra so it appears in the UI but is excluded
    // from the user prompt (it's a runtime config, not prompt input).
    defaultModel: "sonnet",
    extras: [
      {
        key: "modelTier",
        label: "Quality",
        type: "select",
        default: "sonnet",
        transient: true,
        options: [
          { value: "sonnet", label: "Standard · Sonnet" },
          { value: "opus", label: "High · Opus (deeper critique)" },
        ],
        help: "Standard handles most reviews. Use High for senior/handoff-grade critiques.",
      },
    ],
    systemPrompt: readPrompt("interaction-analyst.md"),
    schema: interactionAnalystSchema,
    userInstruction:
      "Analyze the component in this screenshot for interaction quality. Output the JSON object only — no prose.",
  },
  "states-variants": {
    id: "states-variants",
    name: "States & Variants Generator",
    inputs: ["text"],
    // Opus by default — the matrix output is heavy and benefits from
    // Opus's design judgment when picking variant tokens, sizes, and
    // the surrounding text checklist.
    defaultModel: "opus",
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
    systemPrompt: readPrompt("states-variants-generator.md"),
    schema: statesVariantsSchema,
    userInstruction:
      "Generate the component matrix for the component below — variants × sizes × states — using the supplied options as authoritative tokens. Output the JSON object only — no prose.",
  },
  "reference-finder": {
    id: "reference-finder",
    name: "Reference Finder",
    // Special pipeline: stage-1 model extracts a query, server then calls
    // Refero MCP and returns reference cards. Strict JSON schema is used only
    // for the query-extraction stage.
    kind: "references",
    // Haiku is plenty for keyword extraction — saves ~95% vs Opus.
    defaultModel: "haiku",
    inputs: ["image", "text"],
    inputsRequireOneOf: ["image", "text"],
    systemPrompt: readPrompt("reference-finder.md"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "queryType", "platform"],
      properties: {
        query: {
          type: "string",
          description: "Concise 3–8 word search query for Refero.",
        },
        queryType: {
          type: "string",
          enum: ["screens", "flows"],
          description:
            "screens for one-off components/states/screens, flows for multi-step user journeys.",
        },
        platform: {
          type: "string",
          enum: ["ios", "web"],
          description:
            "Target platform: ios for native iPhone/iPad, web for everything else.",
        },
      },
    },
    userInstruction:
      "Extract the best Refero search query, queryType, and platform for what the user is designing. Output the JSON object only — no prose.",
  },
  "dev-handoff": {
    id: "dev-handoff",
    name: "Dev Handoff Checker",
    // Sonnet handles the structured presence/absence checks well; no need
    // for Opus here.
    defaultModel: "sonnet",
    // Multi-image: up to 4 frames, only the first is required so designers
    // can hand off a single screen or a small set without padding the rest.
    imageSlots: [
      { key: "frame1", label: "Frame 1", help: "Required. Primary screen being handed off." },
      { key: "frame2", label: "Frame 2", help: "Optional. Additional frame.", optional: true },
      { key: "frame3", label: "Frame 3", help: "Optional. Additional frame.", optional: true },
      { key: "frame4", label: "Frame 4", help: "Optional. Additional frame.", optional: true },
    ],
    inputs: ["text"],
    inputsRequireAll: ["text"],
    textInputKind: "prompt",
    systemPrompt: readPrompt("dev-handoff.md"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "componentName",
        "summary",
        "verdict",
        "stats",
        "blockers",
        "categories",
      ],
      properties: {
        componentName: { type: "string" },
        summary: { type: "string" },
        verdict: {
          type: "object",
          additionalProperties: false,
          required: ["status", "reason"],
          properties: {
            status: { type: "string", enum: ["ready", "conditional", "not-ready"] },
            reason: { type: "string" },
          },
        },
        stats: {
          type: "object",
          additionalProperties: false,
          required: ["complete", "partial", "missing", "unknown", "total"],
          properties: {
            complete: { type: "integer" },
            partial: { type: "integer" },
            missing: { type: "integer" },
            unknown: { type: "integer" },
            total: { type: "integer" },
          },
        },
        blockers: {
          type: "array",
          description:
            "Short titles of high-severity missing/partial items. Empty array if none.",
          items: { type: "string" },
        },
        categories: {
          type: "array",
          description:
            "All six categories in this exact order: states, interactions, spacing, assets, edgeCases, responsive.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "checks"],
            properties: {
              id: {
                type: "string",
                enum: [
                  "states",
                  "interactions",
                  "spacing",
                  "assets",
                  "edgeCases",
                  "responsive",
                ],
              },
              title: { type: "string" },
              checks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "status", "evidence", "fix", "severity"],
                  properties: {
                    name: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["complete", "partial", "missing", "unknown"],
                    },
                    evidence: { type: "string" },
                    fix: { type: "string" },
                    severity: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    userInstruction:
      "Review the attached frames against the feature description below. Return the structured Dev Handoff Completeness JSON only — no prose.",
  },
  "qa-review": {
    id: "qa-review",
    name: "QA Review",
    // Multi-image agent: design vs built comparison with a unified report
    // (summary + concise issue log + check coverage + recommendations).
    // Sonnet by default; Opus toggle for ship-blocking handoffs.
    defaultModel: "sonnet",
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
    systemPrompt: readPrompt("qa-review.md"),
    schema: qaReviewSchema,
    userInstruction:
      "Compare the design (image 1) with the built implementation (image 2). Produce the unified QA review JSON only — no prose.",
  },
};

export function getAgent(id) {
  return AGENTS[id] ?? null;
}
